# 完整播放链路

MyGo 只接受 http(s) 或 file:// 的音频源。汽水音乐 App/PC 播放接口把音频放在加密的
m4a 里，插件在自身进程内解密后交给宿主播放。除了系统 base64，不需要另装 Node/Electron/ffmpeg；
签名复用本机官方汽水音乐客户端自带的 Electron 运行时（见下）。

## 流程

1. 已登录时先请求 `POST /luna/pc/track_v2`（需要 Cookie；body 见 docs/API.md）。
   2026-11 起该接口强制校验官方签名：未签名请求返回 HTTP 200 + 空 body。插件用
   `X-Helios` 与 `X-Medusa` 两个请求头，通过本机官方汽水音乐客户端自带的
   Electron 运行时（`ELECTRON_RUN_AS_NODE=1 /Applications/汽水音乐.app/Contents/MacOS/汽水音乐 -e ...`）
   调用其官方签名模块 `app.asar.unpacked/bdms.node` 生成，不携带也不分发签名器。
   签名参数（aid 386088、app_name luna_pc、device_id/iid、version_code 30070000、
   channel official、build_mode master 等）按 key 排序拼进 query；`X-SS-STUB` 为
   body JSON 的 MD5（大写）。设备号首次随机生成后持久化在 `host.storage`。
           签名进程常驻：首个请求启动一次官方客户端的 Electron（冷启动约 4 秒），之后每行
   stdin/stdout 一个请求 → 一行签名结果（几毫秒），整个请求-响应交换串行化，避免并发
   点歌抢输出。应用启动/登录后 `account()`/`home()` 会在后台预热进程。签名结果按
  “URL + 请求头”缓存在内存里 10 分钟；若服务端返回 200 空 body，则清缓存重签一次。
2. `track_player.video_model` 是对象，含 `video_duration` 与 `video_list[]`：
   每项有 `main_url`、`video_meta.quality`（medium/higher/highest）、`bitrate`、`size`、
   `encrypt_info{encrypt, kid, spade_a, encryption_method:"cenc-aes-ctr"}`。
3. `video_duration` 明显短于歌曲时长（>5s）→ 视为试听，抛 `unavailable`，不播放片段。
4. 音质映射（MyGo 设置只暴露三档）：
   - `standard` → medium(标准 AAC)
   - `high`（默认）→ higher(高品 AAC ~128 kbps)
   - `lossless` → lossless(无损 FLAC-in-MP4)
   缺档时按 QUALITY_ORDER 降级：lossless → hi_res → highest → higher → medium；
   high → higher → highest → hi_res → medium；standard → medium → higher → highest。
   官方的空间音频、极高（highest）不单独暴露。
5. 若 `encrypt_info.spade_a` 存在：
   - 用内置 base64 解码 + 服务端的密钥编码算法（spade_a）恢复 16 字节 AES 播放密钥；
   - 下载 m4a，解析 ISO BMFF 的 moov/trak/mdia/minf/stbl（stsd/stsc/stsz/stco/senc/saio/saiz），
     按 sample 用 AES-128-CTR 解密（counter = senc IV(8B) || 0(8B)，逐 sample 递增）；
   - 原地把样本入口格式从 `enca`/`encf` 还原成 `sinf/frma` 里的原始格式
     （AAC 是 `mp4a`，无损是 `fLaC`），把 `sinf/senc/saio/saiz` 改成 `free`（保持偏移不变）。
     不能一律写 `mp4a`：FLAC-in-MP4 被标成 AAC 会解码失败。
6. 把明文 m4a 用 base64 文本分块（每块 3×16384 字节）写给
   `host.spawn("/usr/bin/base64", ["-D","-o",path])` 的 stdin，得到 `file://...` 地址返回给宿主；
   插件数据目录里最多缓存 8 首（`playCache`，记录 bitRate/size/quality/request）。
   已有整曲按 `audio-<trackID>-<quality>.m4a` 命中且 `entry.request` 与本次请求音质一致时，
   直接返回 `file://`，不再请求 `track_v2`（0 ms）。
7. 未加密的 `main_url` 直接返回给宿主。

## 快速切歌

宿主播放器在每次切歌时都会启动新的 `stream()` goroutine（`player.go` 的 `open`），
旧 generation 的结果只是被丢弃，并不会取消插件侧还在进行的下载/解密；同时
`ahead.go` 会为下一首预取调用 `Stream()`。快速连点时会有多个旧请求同时抢网络和 CPU。

插件用模块级 `playbackRun` + `AbortController` 只保留最新一次播放请求：

- 新的 `stream()` 开始时 abort 上一个 run；
- `fetchBytes()` 监听 abort，立刻中断音频下载；
- `base64` 进程监听 abort，立刻 `kill()`，不再继续写盘；
- 旧请求在检查点抛 `fail("unavailable", "Playback request was superseded")`，宿主本来
  就会忽略旧 generation 的返回值；
- 被取消的旧请求会清理临时文件并跳过缓存写入，磁盘上只留下真正播放过的曲目。

## 红心与最近播放

- 红心：`POST /luna/pc/me/collection/media`（body `{"scene":"","media":[{"id":...,"type":"track"}]}`）
  收藏；`POST /luna/pc/me/collection/media/delete`（body `{"media":[...]}`）取消。
  与 track_v2 使用同一套官方签名 + `X-SS-STUB`；成功后清空 isLiked 的 60 秒缓存，
  App 的红心会立刻反映到「我喜欢的音乐」。
- 最近播放：App 开始播放时调用 `played`，插件签名 POST
  `/luna/pc/me/recently-played-media`（该路径签名头 `X-Luna-Is-Local-User` 为 `1`）。
- 只实现这两种写操作；评论、歌单编辑、关注等仍未实现。

## 错误

- 未登录：`fail("signIn", ...)`。
- 首次播放没有程序权限：`fail("setup", ...)`，文案指引到 Settings → Allow Programs。
- 签名不可用（未安装官方客户端 / bdms.node 缺失 / 签名输出不全）：
  `fail("unavailable", ...)`，文案说明需要本机安装官方汽水音乐客户端。
- 非会员/无权益/只有试听：`fail("unavailable", ...)`。
- 其它失败回退到 h5 `seo_track` 的明文地址（通常只有试听），再按上面的规则给出错误。

## 平台限制（当前仅 macOS）

- 当前版本只支持 macOS；Windows / Linux 不在支持范围内，README / 插件市场文案也不承诺可用。
- 代码保留 `onMac()` 守卫（`platformName()` 惰性读取 `host.platform`，缺少时按 `darwin` 处理）：
  `launchSigner()`、`signatureFor()`、`deliverEncrypted()` 抛 `fail("setup", PLATFORM_MESSAGE)`；
  `warmSignature()` 直接返回；`cachedStream()` 不读磁盘缓存；`stream()` 跳过 `track_v2`，
  只走 h5 `seo_track` 明文地址。这些守卫只是为了在误安装时避免启动外部程序或写盘，
  不代表支持 Windows / Linux。
- `dataPath(name)` / `fileURLFor(path)` 保留跨平台路径处理（Windows 反斜杠、盘符、URL 转义），
  仅作为防御性代码，不构成平台支持承诺。

## 已知限制

- 宿主没有文件读写 API，只能通过 `host.spawn` 调用系统 `base64` 落盘；权限由用户一次性授予。
- 解密是纯 JS（S-box + T-table + CTR）。Goja 实测 3.5 MB 高品音频约 1.4 s、26 MB 无损约 7 s，
  完整首次播放约 1.9 s（高品）/ 6–9 s（无损）；缓存命中 0 ms。
- 无损解密后的容器是 FLAC-in-MP4（mp4f），需要 MyGo ≥ 0.1.21 的播放器（本机 0.1.22 验证可播）。
- 播放密钥来自当前账号的官方播放接口；没有权益时服务端不会下发完整时长或密钥。
- 官方签名依赖本机安装官方汽水音乐客户端；插件只读取其 `Packages/<版本>/app.asar.unpacked/bdms.node`，
  不修改客户端、不保存签名结果到磁盘。签名 spawn 一次约 300–400 ms；签名按 URL+请求头在内存缓存
  10 分钟，登录后在后台预热，首次播放通常无需再启动签名进程。
