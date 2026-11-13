# Repo guide

- 插件必须保持“安装即用”：index.js 是纯 JS 单文件，安装时不需要任何构建步骤、Node、Electron 或原生二进制。
- 唯一允许启动的外部程序：系统 `/usr/bin/base64`（音频落盘）与 `/usr/bin/env`（以
  `ELECTRON_RUN_AS_NODE=1` 复用本机官方汽水音乐客户端的 Electron 运行时调用其官方签名模块
  `bdms.node`）。不得随插件分发签名器、Node、Electron、ffmpeg 或任何二进制。
- 完整播放只使用当前登录账号在官方接口（`/luna/pc/track_v2`）下发的播放地址与播放密钥；
  不破解 DRM、不绕过账号权益。非会员/无权益曲目保持试听判定并给出清晰提示。
- 不把 Cookie、Authorization 凭据、完整签名 URL、签名请求头（x-helios/x-medusa）、设备号或
  播放密钥写入仓库、日志、错误信息或测试夹具。设备号由插件首次运行时随机生成并只保存在
  `host.storage`。
- 解密后的音频只写 MyGo 插件数据目录（`host.dataDir`），通过系统自带 `/usr/bin/base64`
  落盘，缓存上限 8 首；不要引入 ffmpeg 或其他外部程序。
- 平台范围：当前版本只支持 macOS；README / 插件市场文案不得声明 Windows / Linux 可用，
  后续如需支持另开任务。代码保留 `onMac()` 守卫（读 `host.platform`）：非 darwin 平台禁止 spawn、
  禁止写盘/解密；`stream()` 跳过 `track_v2` 直接走 h5 匿名接口，会员曲目报 `unavailable`。
  拼数据目录路径用 `dataPath()`，拼 `file://` 用 `fileURLFor()`；这些只是防御性代码，不代表平台支持。
- 解密时样本入口必须还原成 `sinf/frma` 里的原始 4CC（AAC=mp4a、无损=fLaC），不能一律改 mp4a。
- 返回给 app 的时间字段必须是毫秒整数：`Track.duration`、`LyricLine.start/end`、
  `LyricWord.start/end`（Go 侧是 int64，传秒的小数会让整个响应反序列化失败）。
- 写操作只允许：喜欢/取消喜欢歌曲（/luna/pc/me/collection/media 与 /delete）、点赞/取消点赞
  评论（/luna/pc/comments/action）、发表一级评论（/luna/pc/comments/create）、收藏/取消收藏
  歌单与专辑（/luna/pc/me/collection/playlist|album 与 /delete）、关注/取消关注艺人
  （/luna/pc/me/collection/artist 与 /delete）、新建/重命名/删除自己的普通歌单、给自己的歌单
  加歌/删歌/排序（/luna/pc/me/playlist 系列与 /luna/me/playlist/media/sort）。回复评论、下载
  离线等其它功能不得自行实现（宿主没有对应接口/已有 Download… 菜单）。收藏成功后要清掉
  isLiked 的 60 秒缓存。
- 收藏歌单/专辑和关注艺人的列表只能从签名接口读：歌单与专辑在
  `/luna/pc/me/collection/mixed`（`item_types` 必须用重复的同名查询参数，不能拼成
  “a,b”），艺人在 `/luna/pc/me/collection/artist`。自己的歌单仍在 unsigned 的
  `/luna/me/playlist`；`playlists()` 必须合并两者并按 `Mine`/`Saved` 标好，收藏来的歌单
  不能标成 mine。`playlists()` 必须过滤 type=1 的「我喜欢的音乐」：侧栏 builtin `liked` 已经是
  同一份列表，再放进 My Playlists 会重复。收藏、关注写入后有 1–3 秒最终一致性：写完清对应 `collectionCache`，界面
  刷新时以服务端为准，不要做乐观更新。
- 歌单编辑前必须校验是自己创建的普通歌单（type 2/3/11）；type 1（我喜欢的音乐）只允许通过
  `collection/media` 加删歌，type 4 等固定歌单拒绝修改。排序接口要求提交完整顺序，读取歌单
  时遇到 MV 等非歌曲内容或超过上限必须放弃排序，不能丢条目。
- `savedAlbums(offset)` 返回 `{albums, more}`，`offset` 是宿主已加载的条目数（不是页码），
  专辑要带 `saved: true`；`album()`/`artist()` 要带 `saved`/`following` 标记，但读取收藏
  状态失败时不能拖垮整页。sidebar 的收藏专辑页依赖 `plugin.json` 里的 `builtin: savedAlbums`。
- 评论读取匿名可用（/luna/pc/comments），登录后优先走签名请求；签名失败/未装官方客户端时
  必须退回匿名请求，评论照常能看。服务端当前不返回 user_digged，不得伪造“已点赞”状态；
  点赞成功后只在本地缓存里更新，刷新后以服务端 count_digged 为准。日志和错误信息不得包含
  评论正文、作者信息或头像 URL。
- 官方签名进程必须常驻复用（stdin/stdout 逐行协议），不得每次请求重新 spawn；App 退出时
  stdin 关闭、进程随之结束。`played` 只做「最近播放」上报，失败不影响播放。
- 听歌模式/私人漫游（`stations` / `stationNext`）只用 PC 侧公开接口（`/luna/pc/feed/mode`、`/luna/pc/discover`、`/luna/pc/feed/song-tab`、`/luna/pc/feed/radio/tracks`），不要要求签名或 spawn，Windows/Linux 也应能取到元数据；`stationNext` 必须按站维护 `count/played/seen/cursor`，对返回曲目去重、`played` 只留最后 30 条，`has_more:false` 或 `next_cursor` 缺失时置 done。探索电台必须区分歌手电台和曲风电台：`style.type===6` 是歌手电台（`flow_type=1`），否则是曲风/类型电台（`flow_type=2`）；`/luna/pc/feed/radio/tracks` 必须带 `flow_type`，否则服务端返回通用推荐流，会出现点 Jessie J 播别人歌的问题。
- `home()` 与 `browse({page:"discover"})` 不得复用同一份推荐数据：首页放听歌模式（`stations()`，前 9 个为私人漫游+常用模式、其余为探索电台）+ 推荐歌单（APP `/luna/discover` 与多轮 PC `/luna/pc/discover/mix` 合并去重后取前 30 张，与 `browse({page:"playlists"})` 共用缓存）；私人漫游（`recommendations`）必须固定出现在听歌模式第一位，首页、听歌模式页、全部模式页都不能被换一批或过滤掉；它没有官方图标时保留空 `imageUrl` 让宿主显示电台占位图，不伪造封面。首页听歌模式与推荐歌单 section 用 `refresh:"home:modes"` / `refresh:"home:playlists"` 放「换一批」（宿主 0.1.28+），同时保留 `morePage` 给旧宿主回退 See All；`refreshBrowse` 的 `home:modes` 轮换 9 个模式，`home:playlists` 只清歌单缓存后返回 `home()`；发现页 Explore Radio / For You 用 `refresh:"discover:radio"` / `refresh:"discover:for-you"` 做单栏刷新，保留 `morePage` 给旧宿主；不要再放榜单/最近播放（侧栏有独立入口）；发现页只放 `/luna/pc/feed/song-tab` 的猜你喜欢 + 探索电台，不再放编辑精选或榜单。榜单统一在 `browse({page:"charts"})`：4 个官方榜都走 PC `/luna/pc/charts/{chart_id}` 并行取，用 `chart.style.bg_url` 做官方封面，卡片 id 用 `chart:<chart_id>`；`playlist()` 负责把 `chart:` 前缀还原成榜单详情。汽水只有 4 个官方歌曲榜，没有专辑/歌手/歌单榜；「上榜专辑」「上榜歌手」只能由 4 个榜的上榜曲目聚合，标题/副标题必须写清楚是聚合，不能冒充官方榜。听歌模式已并入首页，plugin.json 不再注册 `stations` 导航。
- 音质映射固定为：MyGo `standard`→官方 medium、`high`→higher、`lossless`→lossless，
  缺档按 `QUALITY_ORDER` 降级；播放缓存条目必须带 `request` 字段，不同音质不能互相命中。
- 插件 id 是 `qishui`，`plugin.json` 的 `name` 为英文 key `Qishui Music`（中文 locale 译作「汽水音乐」）；数据目录为 `plugin-data/qishui`。
- 首页/全部听歌模式卡片的图片只用随插件分发的 `assets/modes/<sceneID>.webp`（由官方 `/luna/pc/feed/mode` 图标生成）：不能拿榜单/歌单/电台封面冒充模式封面（会出现「粤语」显示林俊杰这类错配），也不能重画成别的图形。缺失时先回退官方 `imageUrl`，再缺就留空让宿主占位，不要随机找图。新增模式后运行 `tools/build-mode-assets.py` 重建渐变方卡图。默认模式页只放 9 个常用模式 + 官方照片电台；45 个场景模式放在 `all-modes` 页。
- 界面文案必须 i18n：所有用户可见字符串写成 `tr("English key")`，英文是 key，中文放在
  `locales/zh-CN.json`。模块顶层不能调用 `host`，所以不要用 `tr()` 初始化顶层常量；在导出函数里
  再翻译。`plugin.json` 的 `name` 与 `navigation[].title` 用英文 key，宿主会读同一个 locale 文件翻译。
  新增/修改文案后要同步 `locales/zh-CN.json`，否则中文界面会回退成英文。
- docs/API.md 记录真实请求与响应形状（脱敏）；docs/RUNTIME.md 记录宿主契约；
  docs/PLAYBACK.md 记录完整播放链路与已知限制。
- 修改播放链路后至少跑：`node --experimental-vm-modules tools/harness/run.mjs --plugin . --routes tools/harness/fixtures/routes.json`
  与 Go 加载冒烟 `tools/harness/go/run-go.sh .`。

- 隐私红线：fixtures/、docs 示例、日志与测试数据只能使用合成数据，不得出现真实账号昵称/uid、
  私密歌单 ID、听歌历史/收藏列表、评论原文或本机设备号；用真实账号探测后必须先替换为虚构样本
  再提交。git 提交身份固定为 `qile222 <qile222@users.noreply.github.com>`，不得使用公司邮箱
  或公司账号。
- 匿名请求标识（如 `APP_PARAMS.iid`）必须在运行时随机生成，不得把固定设备标识写进代码、
  文档或探针脚本。
