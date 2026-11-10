# MyGo Music 汽水音乐插件

纯 JavaScript 的 MyGo Music 汽水音乐音源。不需要你安装 Node.js、Electron 或任何原生 helper：
安装 = 一个插件文件夹（或 zip），重启应用即用。

签名说明：汽水服务端从 2026-11 起对播放接口校验官方签名。插件不携带任何签名器，
而是在你**本机已安装官方「汽水音乐」macOS 客户端**时，用该客户端自带的 Electron 运行时
只调用它的官方签名模块（`bdms.node`）。没装官方客户端时，插件仍可浏览/搜索，但完整播放会回退为试听或提示不可用。

- MyGo Music ≥ 0.1.22（本机 0.1.22 验证）
- 本机安装官方「汽水音乐」macOS 客户端（用于播放接口签名；不需要启动它）
- 登录：应用内扫码（用汽水音乐 App 扫宿主弹出的二维码）
- 播放：登录账号有权益的歌曲完整播放；非会员/无权益曲目按试听处理并给出明确提示

## 平台支持

当前版本**只支持 macOS**。Windows / Linux 暂不支持，也不在 README / 插件市场文案里承诺可用。

代码里保留了非 macOS 的降级守卫（不启动外部程序、不写盘、不解密），只是为了在误安装时
给出明确错误，不代表支持这些平台。

## 功能

- 首页：只放推荐歌单；私人漫游/听歌模式、榜单、最近播放等都有独立侧栏页面，首页不再重复
- 听歌模式：私人漫游 + 官方 8 个常用模式（熟悉/新鲜/抖音漫游/摸鱼/驾车/快乐时光/Chill 放松/专注）+ 探索电台；点卡片或 Start Listening 后按模式持续出歌
- 发现：编辑精选歌单 + 猜你喜欢（与首页数据不同但仍来自汽水官方推荐接口）
- 榜单 / 我喜欢 / 收藏专辑 / 最近播放（侧栏「我喜欢」已独立，下面 My Playlists 不再重复「我喜欢的音乐」）
- 搜索：单曲、专辑、艺人、歌单
- 艺人页、专辑页、歌单页；KRC 逐字歌词 + LRC（播放页 Lyrics 面板）
- 红心：在 App 里点红心即可收藏/取消收藏，写入汽水「我喜欢的音乐」，列表红心状态与账号同步
- 歌单：App 里可新建歌单、重命名、删除、加歌/删歌、拖动排序；收藏/取消收藏别人的歌单
- 收藏专辑：侧栏「收藏专辑」页；专辑页可收藏/取消收藏
- 关注歌手：歌手页可关注/取消关注
- 评论：播放页 Comments 面板可看评论（总数、头像、时间、点赞数），点拇指点赞/取消，登录后可发评论
- 播放上报：开始播放时同步到汽水自己的「最近播放」
- 完整播放：登录后经官方 PC 播放接口（带官方签名）取音频，插件内纯 JS 解密后交给播放器（无需 ffmpeg）
- 无损音质：支持官方「无损」FLAC-in-MP4（在 MyGo 设置里选 Lossless 即可）
- 播放缓存：最近 8 首解密后的整曲；重复播放、以及连续播放时应用自动预取下一首，基本秒开

评论说明：读取评论匿名即可（登录后优先走签名请求）；当前服务端不返回「我是否点过赞」，
所以刷新后评论红心会回到未点亮状态，点赞数仍以服务端为准。发表评论需要登录，只在应用内
输入并提交，插件不做自动发帖或回读。

## 音质档位

MyGo 的播放设置只暴露三档（Settings → Playback → Quality），对应汽水官方档位：

| MyGo | 插件请求 | 汽水官方档位 | 典型码率 / 体积 |
| --- | --- | --- | --- |
| Standard | `standard` | medium（标准 AAC） | ~64 kbps，约 1–2 MB/首 |
| High（默认） | `high` | higher（高品 AAC） | ~128 kbps，约 3–5 MB/首 |
| Lossless | `lossless` | lossless（无损 FLAC） | ~0.8–1.6 Mbps，约 20–30 MB/首 |

曲目没有所选档位时按顺序降级：lossless → hi_res(320k AAC) → highest(极高) → higher → medium；
high → higher → highest → hi_res → medium；standard → medium → higher → highest。
官方的「空间音频」和「极高」不单独暴露（lossless 缺档时会自动降到 hi_res/极高）。

## 速度

真机实测（Goja，一首未缓存的 128 kbps 曲目，从点击到播放器开始出声）：

| 阶段 | 耗时 |
| --- | --- |
| 官方签名（常驻进程，首次播放 0ms） | ~0–5 ms |
| track_v2（含签名校验） | ~250 ms |
| 下载加密音频（约 3.5 MB） | ~270 ms |
| 纯 JS CENC 解密（AES-128-CTR） | ~1.4 s |
| base64 分块落盘 | ~210 ms |
| **合计** | **~1.9 s**（0.1.x 为 ~2.8 s） |

- 签名进程常驻：应用启动/登录后就在后台把官方签名进程拉起来（冷启动一次约 4 秒），
  之后每首歌只走 stdin/stdout 一行（几毫秒），不再出现「点歌后几秒没有下载」的停顿，
  也不会每首歌重复启动进程。
- 刚启动应用就立刻点歌时，签名进程可能还在冷启动，最多多等 1–4 秒；等几秒后再点歌，
  首次播放约 1.9 秒。
- 已缓存的整曲直接在 `playCache` 命中并返回 `file://`，不再请求 `track_v2`：**0 ms**。
- base64 编码与落盘改成分块流式（每块 48 KB 字节），避免一次性生成几 MB 字符串造成的 GC 停顿。
- 无损曲目体积大（约 26 MB），首次播放约 6–9 s，之后走缓存秒开。

## 安装

1. 把本文件夹（含 `plugin.json` 与 `index.js`）放进：
   `~/Library/Application Support/MyGo Music/plugins/qishui`（或 MyGo Music → Settings → Plugins → + 选择文件夹/zip）。
2. 重启 MyGo Music，在 Settings → General 的 source 里选择「汽水音乐」。
3. 首次完整播放时，播放器会提示需要「允许启动程序」：Settings → 汽水音乐 →
   **Allow Programs / 允许启动程序**。插件只调用两个本机已有程序：系统自带的
   `/usr/bin/base64`（把解密后的音频写到插件数据目录）和 `/usr/bin/env`（以
   `ELECTRON_RUN_AS_NODE=1` 复用官方汽水音乐客户端的 Electron 运行时调用官方签名模块）。
   不会安装、下载或打包任何程序，也不会上传账号信息。
4. 如提示签名不可用：确认 `/Applications/汽水音乐.app` 存在，再重试；未安装官方客户端时
   无法完整播放受保护曲目。

从 0.1.x（`qishui-lite`）升级：安装新目录 `plugins/qishui` 后，把旧
`plugin-data/qishui-lite/storage.json`（含登录态）复制到 `plugin-data/qishui/`，
再删掉旧的 `plugins/qishui-lite`。旧的音频缓存可不迁移。

## 登录

点应用里的 Sign in → 宿主弹出二维码 → 用汽水音乐 App 扫码确认。Cookie 只保存在
MyGo 的插件数据目录（`plugin-data/qishui/storage.json`），不会写进仓库或日志。

## 限制

- 写操作仅限登录后：红心、评论点赞/发表、歌单编辑与收藏、专辑收藏、关注歌手。这些接口同样
  需要官方签名；没装官方客户端或未允许启动程序时只能浏览/播放，写操作会提示需要签名。
- 评论只能发一级评论：汽水没有给插件可用的回复接口，宿主也没有楼中楼 UI，所以不能回复评论。
- 离线下载用宿主自带的歌曲菜单 **Download…** 即可（插件已提供可播放的完整音频），插件不另做下载器。
- 收藏/关注写入后有 1–3 秒的最终一致性，刚操作完刷新列表偶尔会慢一拍，以刷新后的服务端结果为准。
- 非会员或单曲无权益时，官方接口只给 30–60 秒试听片段，插件会标记为不可用，不绕过。
- 接口来自汽水音乐 App / PC 端公开接口，随时可能变化；测试见 `tools/harness`。
- 本插件不包含任何账号凭据或完整签名 URL。
- 当前版本只支持 macOS；Windows / Linux 暂不支持。

## 开发与验证

- 入口：`index.js`（单文件，宿主内没有模块加载器，不能 import/require）
- Manifest：`plugin.json`（网络域名白名单、`/usr/bin/base64` 与 `/usr/bin/env` 进程权限、导航）
- 接口实测矩阵：`docs/API.md`；宿主运行时契约：`docs/RUNTIME.md`；播放链路：`docs/PLAYBACK.md`
- 无头契约测试：

  ```sh
  node --experimental-vm-modules tools/harness/run.mjs --plugin . --routes tools/harness/fixtures/routes.json
  node --experimental-vm-modules tools/harness/selftest.mjs
  ```

- Go 真实插件加载冒烟：`tools/harness/go/run-go.sh .`（需要 MyGo 源码，默认 `/tmp/qsresearch/mygo-music`）

## 目录

- `index.js` / `plugin.json`：插件本体
- `docs/`：接口、运行时与播放链路文档
- `fixtures/`：脱敏的接口响应样本
- `tools/`：只读探针与无头测试脚手架

## 许可

MIT
