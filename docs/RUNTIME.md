# MyGo Music 插件运行时契约（0.1.22）

> 适用对象：为 MyGo Music 编写 stream 型音乐插件（本仓库是汽水音乐 Lite 插件）。
> 核对依据：MyGo Music 源码 `mygo-music`（MIT）commit `1af0d8e`，版本 `0.1.22`；JS 运行时 moejs `v0.1.0-alpha.11`；本机安装版 `/Applications/MyGo Music.app`（0.1.22）实测。
> 文中 `internal/...` 均指 MyGo Music 源码里的路径，行号为 0.1.22 源码行号。汽水 API 的字段/签名见 [API.md](API.md)。
> 本文可独立于 API.md 使用；契约信息全部来自 MIT 许可的 mygo-music，不引用 AGPL 的 lane-qishui。

---

## 0. 数字速查

| 项 | 值 |
| --- | --- |
| 一次导出调用超时（`callTimeout`） | **30 秒**（plugin.go:46） |
| `signIn` 导出超时 | **5 分钟**（plugin.go:48） |
| 超时后判定"卡死"的宽限 | **1 秒**（plugin.go:51）；真卡死会重启插件 |
| 插件内存上限 | **256 MiB**（`256 << 20`，plugin.go:53） |
| 单个模块 | `plugin.json` 的 `main`（默认 `index.js`；`.ts` 也可），**不允许 import** |
| 插件目录 | 用户数据目录下 `plugins/<id>/` |
| 插件数据目录 | 用户数据目录下 `plugin-data/<id>/`（`host.dataDir`） |
| fetch 网络权限 | 只允许 `permissions.network` 内的 host；空数组 = 完全不能联网 |
| fetch 客户端超时 | 10 分钟（plugin.go:497），但实际受 30 秒调用超时约束 |
| 启动/调用模型 | 懒启动：第一次调用导出函数时才执行模块顶层；导出集合编译期已知 |
| 日志 | `console.*` → Go `log.Printf("plugin <id>: ...")` → 进程 stderr；无日志文件 |

---

## 1. 安装、目录与版本

### 1.1 目录

用户数据目录 = `mygo.App.Path(mygo.PathUserData)` = `os.UserConfigDir()/<App.Name()>`：

- macOS：`~/Library/Application Support/MyGo Music/`
- Linux：`~/.config/MyGo Music/`（WebView 关闭，见 `mygo.config.ts`）
- Windows：`%AppData%\MyGo Music\`

其下：

- `plugins/<id>/`：插件本体（`plugin.json` 必须在其顶层，或唯一一层子目录的顶层）。
- `plugin-data/<id>/`：插件的数据文件夹，即 `host.dataDir`。里面由运行时管理：
  - `settings.json`：`{ "<key>": "<string>" }`，由设置界面写入，或 `plugin.SetSetting` 写入。
  - `storage.json`：`{ "<key>": <任意 JSON> }`，由 `host.storage.*` 读写。
  - `granted.json`：记录"进程权限是否已授权"。
- 插件数据由安装/更新/卸载保留；卸载只把 `plugins/<id>/` 移进废纸篓，不删 `plugin-data/<id>/`。

安装后的目录结构示例：

```
plugins/qishui-lite/
  plugin.json
  index.js
  locales/zh-CN.json     # 可选
```

### 1.2 安装来源

1. 本地文件夹 / 本地 zip（界面"从文件夹安装"）。
2. GitHub 仓库最新 release（release 资产里的 zip）：
   - 优先 `*<goos>*<goarch>*.zip`（如 `mygo-music-darwin-arm64.zip`）；
   - 其次不含任何平台名的 `*.zip`；
   - 都没有则下载 release 的源码 zipball（`zipball_url`）。
   - 仓库没有 release 时，取 `HEAD` 的 commit zipball。
3. URL scheme：`mygo-music://install-plugin?repo=owner/repo`（开发版是 `mygo-music-dev:`）。

安装后写 `plugins/<id>/.origin.json`：`{"repo":"owner/repo","version":"..."}`，用于更新与冲突判断。

### 1.3 zip / 文件夹约束

- 解压根：`plugin.json` 在 zip 顶层，或 zip 只有一个顶层目录且其中有 `plugin.json`；否则报 `it has no plugin.json at its top: it isn't a plugin`。
- **拒绝符号链接**（`a link in the plugin: ...`）；点文件/点目录（如 `.git`）跳过不复制。
- 保留可执行位（`mode & 0o111` → 0755，否则 0644），可执行文件随插件分发是允许的。
- 上限：归档 ≤ 1 GiB（`maxArchive`）、解压总量 ≤ 2 GiB（`maxUnpacked`）、文件数 ≤ 50000（install.go:39-41）。
- 安装/更新按 `plugin.json` 的 `id` 判断冲突：同 `id` 且 `.origin.json` 的 repo 不同 → 拒绝（`a plugin called <id> is already installed`）；本地安装只替换本地安装。
- 更新检查每 24 小时一次；新 manifest 若要求更多 network/process 权限会重新征得同意。

### 1.4 id、main、minAppVersion

- `id`：必填，正则 `^[A-Za-z0-9][A-Za-z0-9_.-]*$`；同时是插件数据目录名，`..` 之类会 `a plugin can't be called "..."`。0.1.22 起强制 id/`main` 不能指向插件目录外。
- `name`：可选，默认 = `id`。
- `version`：可选，字符串；更新比较按点分整数（可带 `v` 前缀，不接受 `1.2.3-beta` 这类后缀）。
- `main`：可选，默认 `index.js`；必须是插件目录内的相对路径（`filepath.IsLocal`）；以 `.ts` 结尾时用 TS 编译器，其余按 JS 编译。
- `minAppVersion`：可选；格式同 `0.1.8`（点分整数，可 `v` 前缀）。`appVersion` 为空（开发构建）时任何插件都加载；安装版低于该版本返回 `NeedsNewerApp`，界面提示 `<name> needs MyGo Music <ver> or later. Update MyGo Music first.`。
- **注意**：本仓库 `plugin.json` 当前 `minAppVersion` 是 `0.1.20`，而 fMP4（分片 MP4）直链播放依赖 **0.1.21+**。若汽水 stream 走 fMP4/DASH，应把 `minAppVersion` 提到 `0.1.21`（`plugin.json` 不归本文档修改，交给 Lead 决策）。

### 1.5 相关版本行为（CHANGELOG 摘）

- 0.1.18：支持 ALAC / AAC / WAV 播放。
- 0.1.19：新增 `requestHeaders`（图片/音频带 cookie 等头），跨 host 重定向时丢弃插件头。
- 0.1.20：图片 URL 支持 `{size}` 占位符；插件在模块顶层同步读 `host.storage`/`host.setting` 不再卡启动。
- 0.1.21：分片 MP4（fMP4，AAC/FLAC-in-MP4）边下边播，插件可直接给 DASH/fMP4 URL，无需转码。
- 0.1.22：插件 id 与 main 必须停留在插件文件夹内；`ErrSetup` 的原因会显示给用户；随机播放修复。

---

## 2. plugin.json

运行时结构（plugin.go:125-134 的 `Manifest` = 内嵌 `music.Info` + 以下字段）：

```json
{
  "id": "example",
  "name": "Example",
  "version": "0.1.0",
  "playback": "stream",
  "main": "index.js",
  "minAppVersion": "0.1.8",
  "settings": [{"key": "server", "label": "Server", "help": "..."}],
  "navigation": [{"builtin": "home", "title": "Home", "icon": "home"}],
  "permissions": {
    "network": ["api.example.com", "*.example.com", "*"],
    "process": ["bin/helper-*", "ffmpeg"]
  },
  "requestHeaders": [
    {"hosts": ["{setting:server}"], "kinds": ["image", "audio"], "headers": {"cookie": "token={storage:token}"}}
  ]
}
```

### 2.1 字段

| 字段 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | — | 见 1.4；同时是数据目录名 |
| `name` | 否 | `id` | 界面显示名；可被 `locales` 翻译 |
| `version` | 否 | `""` | 更新比较用 |
| `playback` | 否 | `"stream"` | `stream` 或 `remote`（远程控制型源）。本插件用 `stream` |
| `main` | 否 | `"index.js"` | 单模块入口，必须留在插件目录内 |
| `minAppVersion` | 否 | `""` | 见 1.4 |
| `permissions` | 否 | `{}` | 见 2.2 |
| `requestHeaders` | 否 | 无 | 见 2.3 |
| `settings` | 否 | 无 | 见 2.4 |
| `navigation` | 否 | 无 | 见 2.5 |
| 未知字段 | — | — | JSON 解码忽略，不报错 |

### 2.2 permissions

```json
"permissions": {
  "network": ["api.qishui.com", "*.qishui.com", "*.douyinpic.com"],
  "process": []
}
```

- `network`：数组，每项是 host 模式。
  - `*` = 任意 host（安装时提示 "Can reach any website"）。
  - `*.example.com` = 只匹配**子域**（不匹配 apex `example.com`；apex 要单独写）。匹配由 `webapi.AllowHosts` 完成。
  - 空数组 = fetch 什么都不通（`webapi.Options{}`，`fetch` 直接 reject）。
  - 每次请求、每次重定向都检查一次，权限外的 host 会被拒绝。
  - 有 `process` 权限且用户授权后，运行时自动追加 `127.0.0.1` 与 `localhost`（给插件访问自己启动的本地程序）。
- `process`：数组或 `true`。
  - `true` 等价于 `["*"]`（旧格式：任意程序）。
  - 每项是程序名（PATH 上查找）或相对插件目录/绝对路径，按 `filepath.Match` 匹配（`*` 不跨目录）。
  - 需要用户在设置里显式 **Allow**（`granted.json`），否则 `host.spawn` 报错；撤销/授权会重启插件。
  - 子进程以插件目录为 cwd，可执行权限等同于用户本人——权限很重，插件应尽量不用。

### 2.3 requestHeaders

用于给"图片"和"音频下载"自动加请求头（典型：cookie、referer、ua），因为这两类请求由 app 自己发起，插件没法插手。

```json
"requestHeaders": [
  {
    "hosts": ["{setting:server}", "api.qishui.com"],
    "kinds": ["image", "audio"],
    "headers": {"cookie": "music-token={storage:token}"}
  }
]
```

- 顶层必须是数组；每项必须有非空 `hosts` 和非空 `headers`（否则 Load 报 `requestHeaders[i] needs hosts and headers`）。
- `kinds` 可选，值只能是 `"image"` / `"audio"`；不写 = 两类都适用。
- `hosts` 每项：
  - 字面 host 或 `*.example.com`（**不能**写 `*`、不能带 `{}`、`/`、`:`；报 `host "..." isn't a host or *.domain`）。
  - `{setting:key}`：运行时取 `settings.json` 里该 key 的值，解析成 URL/host[:port]，用其 hostname 匹配。
  - 每个 host 都必须被 `permissions.network` 覆盖（`host "..." is outside the network permission`）。
- `headers` 的 key 不能是 `host`、`content-length`。
- 值里的占位符 `{setting:key}` / `{storage:key}` 在**请求时**解析。值为空（setting 没填/未登录）→ **整个 header 被省略**，适合"登录前不发 cookie"。值含 CR/LF → 拒绝（防 header 注入）。
- `storage` 值不是字符串时，按其 JSON 序列化结果发送。
- 合并行为：
  - 图片：app 全局对源返回的 `imageUrl` 使用（0.1.19+），`{size}` 占位符会替换成实际像素尺寸。
  - 音频：`Plugin.Stream` 返回后，若 stream 自己的 `headers` 没有同名（大小写不敏感）header，则补上 `requestHeaders` 音频规则的 header；**stream 自己的 headers 优先**（source.go:288-299）。
  - 跨 host 重定向时，app 会丢弃**全部**插件 header（同 host 或其子域才保留），签名的 cookie 不会被带到第三方域。

### 2.4 settings

```json
"settings": [
  {"key": "server", "label": "Server", "help": "Like api.example.com", "link": "https://example.com/settings"}
]
```

- 设置界面每项一行；`label`/`help` 可被 locales 翻译；`link` 显示为可点击链接（打开默认浏览器）。
- 值只存字符串（`settings.json`）。插件读：`host.setting(key)`（未设置 = `""`）。
- 用户改设置时：先写 `settings.json`，若插件**正在运行**且导出了 `setSetting`，再调用 `setSetting({key, value})`；该调用的错误会显示给用户。
- 插件自己也可以在运行时通过 `host.setting` 读取最新值（无需重启）。

### 2.5 navigation

```json
"navigation": [
  {"builtin": "home", "title": "首页", "icon": "home"},
  {"page": "discover", "title": "发现", "icon": "star"},
  {"builtin": "liked", "title": "我喜欢", "icon": "heart"}
]
```

- 每项必须有 `title`。
- `builtin`（二选一）：`home` | `liked` | `savedAlbums` | `stations` | `shows` —— 对应 app 内置页面。
- `page`（二选一）：自定义页面名，点击时调用插件 `browse({page})` 取 `Browse`。
- `icon` 可选，取值：`home, note, album, artist, playlist, radio, podcast, chart, calendar, heart, search, star`。
- **不写 `navigation`**：app 自动把源支持的页面（按其导出函数判断）加进侧栏。
- 写了 `navigation`：只显示列出的项。列了某页面但插件没导出对应能力，打开会得到 `unsupported` 错误，建议只列真正实现的。

### 2.6 locales

- 目录 `locales/<language>.json`，内容是 `{"English text": "译文"}`。
- app 只读它支持的语言文件；中文界面下是 `locales/zh-CN.json`。
- 作用范围：`name`、`settings[].label/help`、`navigation[].title`（由 `Info()` 应用，plugin.go:646-661），以及 `host.t(text)` 运行时翻译。
- `host.t` 找不到译文时原样返回英文 key（所以请以英文文案为 key）。
- 非英文语言缺文件 = 不翻译，不报错。

---

## 3. 模块与导出（Source 协议）

### 3.1 加载与调用语义

- 插件是**单个 ES 模块**：`export function home() {...}` 这类写法；可使用 `import`/`export` 语法编译，但**没有 linker，也没有 `import()`/`require`**，实际只能写一个文件（资源用 `host.dir` + `file://` 或网络）。
- `Load` 只编译不运行；导出名在编译期已知（`mod.Exports()`），`Can("home")` 不启动插件。首次调用任一导出才执行模块顶层并启动事件循环。
- 每个导出收到**一个对象**参数（无参数时收到 `undefined`）；可以返回普通值，也可以返回 `Promise`。返回值 `undefined` 会被当作 `null`（helper：`r === undefined ? null : r`）。
- 参数/返回值都用 JSON 编解码：只支持 JSON 可表示的值；不要返回 `Map`/`Set`/函数/循环引用；字段名用下文的 camelCase。
- 同步导出里不要做 >30s 的 CPU 工作；所有导出都在事件循环上执行（JS 单线程），一个死循环会拖垮插件，超时后若 1s 内事件循环仍不接任务，插件被重启（runtime 关闭，数据保留）。
- 错误写法：`throw new Error("...")`，或带 code 的对象错误：
  ```js
  const err = new Error("sign in first");
  err.code = "signIn";
  throw err;
  ```
  - `code` ∈ `signIn` | `setup` | `unavailable` | `unsupported`；其余 code/无 code 当作普通错误，UI 显示 `message`。
  - `message` 会显示给用户（`setup` 场景下有专门展示），不要放 cookie/token/签名 URL（AGENTS.md 约定）。
- 不导出某方法 = 该能力不存在：app 调它会得到 `unsupported`（`music.ErrUnsupported`），UI 会隐藏相应功能。建议**只导出真正实现的**导出名，而不是每个都抛 `unsupported`。
- 只有 `signIn` 用 5 分钟超时；其余 30 秒。


### 3.2 导出函数总表

导出名 = `music.Source` 方法名首字母小写（source.go:31-337 逐个确认）。参数是一个 JSON 对象；返回可以是值或 Promise。**不导出 = 没有该能力**（app 得到 `unsupported`）。

| 导出名 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `signIn` | 无 | `Account` | 登录；唯一 5 分钟超时的调用。登录过程中用 `host.signInPrompt` / `host.webSignIn` 与用户交互 |
| `signOut` | 无 | 无 | 退出登录 |
| `account` | 无 | `Account \| null` | 当前账户；null = 未登录 |
| `search` | `{query: string, kind: "tracks"\|"albums"\|"artists"\|"playlists"\|"shows", offset: number}` | `SearchResult` | 分页搜索；见 §3.4 |
| `suggest` | `{query: string}` | `string[]` | 搜索联想词 |
| `home` | 无 | `Browse` | 首页 |
| `browse` | `{page: string}` | `Browse` | 自定义页面（`navigation[].page` 或 `morePage` 跳转） |
| `playlists` | 无 | `Playlist[]` | 歌单列表 |
| `playlist` | `{id: string}` | `Playlist` | 歌单详情（`tracks` 可含分页信息） |
| `album` | `{id: string}` | `AlbumPage` | 专辑页 |
| `artist` | `{id: string}` | `ArtistPage` | 歌手页 |
| `liked` | `{offset: number}` | `Page` | "我喜欢的音乐"，分页 |
| `recent` | 无 | `Track[]` | 最近播放（由 app 维护时也可不实现） |
| `isLiked` | `{ids: string[]}` | `Record<string, boolean>` | 批量判断是否已喜欢；key 是 track id |
| `like` | `{id: string, on: boolean}` | 无 | 喜欢/取消喜欢歌曲 |
| `likeEpisode` | `{id: string, on: boolean}` | 无 | 喜欢/取消喜欢播客单集 |
| `createPlaylist` | `{name: string}` | `Playlist` | 新建歌单，返回创建结果 |
| `renamePlaylist` | `{id: string, name: string}` | 无 | 重命名 |
| `deletePlaylist` | `{id: string}` | 无 | 删除 |
| `addToPlaylist` | `{id: string, trackIds: string[]}` | 无 | 加歌 |
| `removeFromPlaylist` | `{id: string, trackIds: string[]}` | 无 | 移除歌 |
| `movePlaylistTrack` | `{id: string, from: number, to: number}` | 无 | 调整顺序（0 基） |
| `savePlaylist` | `{id: string, on: boolean}` | 无 | 收藏/取消收藏歌单 |
| `followArtist` | `{id: string, on: boolean}` | 无 | 关注/取关歌手 |
| `saveAlbum` | `{id: string, on: boolean}` | 无 | 收藏/取消收藏专辑 |
| `savedAlbums` | `{offset: number}` | `AlbumList` | 收藏专辑，分页 |
| `shows` | 无 | `Show[]` | 播客列表 |
| `show` | `{id: string, offset: number}` | `ShowPage` | 播客详情 + 单集分页 |
| `subscribeShow` | `{id: string, on: boolean}` | 无 | 订阅/取消订阅播客 |
| `stations` | 无 | `Station[]` | 电台/漫游列表 |
| `stationNext` | `{id: string}` | `Track[]` | 电台下一批歌曲 |
| `comments` | `{trackId: string, offset: number}` | `CommentPage` | 歌曲评论分页 |
| `likeComment` | `{trackId: string, commentId: string, on: boolean}` | 无 | 点赞评论 |
| `postComment` | `{trackId: string, text: string}` | `Comment` | 发评论，返回新评论 |
| `played` | `{id: string}` | 无 | app 在歌曲开始播放时通知（用于计数/推荐）；该调用的普通错误只写日志 |
| `lyrics` | `{id: string}` | `Lyrics` | 歌词 |
| `stream` | `{id: string, quality: string}` | `Stream` | **播放地址**；quality ∈ `standard`/`high`/`lossless` |
| `remotePlay` | `{ids: string[], start: number, position: number}` | 无 | 远程播放（仅 `playback: "remote"` 源的设备控制） |
| `remotePause` / `remoteResume` | 无 | 无 | 远程暂停/继续 |
| `remoteSeek` | `{position: number}` | 无 | 远程跳转（毫秒） |
| `remoteVolume` | `{percent: number}` | 无 | 远程音量 0-100 |
| `remoteState` | 无 | `RemoteState \| null` | 远程播放状态 |
| `remoteDevices` | 无 | `Device[]` | 可控制的设备 |
| `remoteUse` | `{deviceId: string}` | 无 | 切换控制目标 |

另外两个**非 Source** 特殊导出：

- `setSetting`（可选）：用户在设置界面改设置时调用，入参 `{key: string, value: string}`；返回/抛错会显示给用户。见 §2.4。
- 其他名字的导出不会被调用。

### 3.3 返回结构的 JSON 字段（music.go）

字段名必须与下表一致（Go struct 的 JSON tag；缺省字段用 `null`/省略均可，数组推荐空数组而不是 null）。标记"app 填"的字段由 app 写，插件**不要返回**。

```
Account      { id, name, imageUrl?, page? }
Track        { id, name, artists?, album, duration?, url?, unavailable?, showId?, description?, published? }
Artist       { id, name, imageUrl?, following? }
Album        { id, name, imageUrl?, artists?, released?, saved? }
Playlist     { id, name, imageUrl?, description?, owner?, trackCount?, mine?, saved?, fixed?, tracks? }
SearchResult { tracks?, albums?, artists?, playlists?, shows?, more? }
Browse       { title?, subtitle?, imageUrl?, description?, sections? }
Section      { title?, tracks?, albums?, artists?, playlists?, shows?, stations?, links?, morePage?, empty?, pageTitle?, subtitle? }
Link         { title, subtitle?, imageUrl?, page }
NavItem      { title, page?, builtin?, icon? }
Page         { tracks?, more? }
AlbumList    { albums?, more? }
AlbumPage    { album, tracks? }
ArtistPage   { artist, tracks?, albums? }
Show         { id, name, imageUrl?, description?, publisher?, publisherPage?, episodeCount?, subscribed? }
ShowPage     { show, episodes?, more? }
Station      { id, name, description?, imageUrl? }
Comment      { id, author, avatarUrl?, text, time?, likes?, liked? }
CommentPage  { comments?, total?, more? }
Lyrics       { lrc?, translation?, lines? }
LyricLine    { start, end?, text?, translation?, words? }
LyricWord    { start, end, text }
Stream       { url, type, quality?, bitRate?, size?, peak?, gain?, headers? }
Device       { id, name, active? }
RemoteState  { playing, trackId?, position, duration, volume, device? }
```

要点：

- `Track`：`id` + `name` + `album` 必备（`album` 至少给 `{id, name}`）；`duration` 是**毫秒**；`url` 是"源站歌曲页"链接（分享/复制链接用），不是音频地址；`unavailable: true` = 无版权/不可播，UI 会置灰并跳过；播客单集用 `showId`/`description`/`published`（`published` 是 ISO 时间字符串）。
- `Album.released` 是字符串（如 `"2024-01-01"` 或年份），app 只展示。
- `Playlist.fixed`：true = 固定顺序歌单（不允许拖动排序）。
- `Section` 里同一个 `Browse` 可以有多种横向列表：tracks/albums/artists/playlists/shows/stations/links，各列表并行展示；`morePage` 是"查看全部"跳转的 `page` 名（点击调用 `browse({page})`）；`empty` 是非空时的占位文案（列表为空时显示）；`pageTitle`/`subtitle` 用于卡片详情页标题。
- `Lyrics.lrc`：整段 LRC 文本（app 自己解析）；也可以给结构化的 `lines`（`start/end` 秒，`text`，`translation`，逐字 `words`）；两者可同时给，app 优先用 `lines`（有逐字时更好）。
- `NavItem.builtin` ∈ `home|liked|savedAlbums|stations|shows`；`icon` ∈ `home|note|album|artist|playlist|radio|podcast|chart|calendar|heart|search|star`。
- `Stream.type`：`"mp3"`、`"flac"`、`"ogg"`、`"wav"`、`"m4a"`、`"aac"`。**只用于缓存文件命名与"无损"徽标**，实际容器由 app 嗅探字节（见 §6），但请尽量填对。
- `Stream.size`：精确字节数时填（缓存完整性与预分配用）；`bitRate` 目前 app 不用；`gain`/`peak` 用于 ReplayGain 音量归一化（dB / 线性峰值）。
- `SignInPrompt`：`{qr?, text?}`；`qr` 是**待编码的内容**（URL/token 字符串），app 负责生成二维码，不是图片 URL。

### 3.4 分页约定

- `search`：`offset` = app 已加载的**该 kind 条目数**（`SearchResult` 五个数组里已展示的数量，按 kind 计）。返回里 `more: true` 才会继续显示"加载更多"；`more` 缺省/false 表示没有下一页。最后一页务必 `more: false`（app 用 `more && len>0` 判断）。
- `liked`/`savedAlbums`/`comments`/`show`：同样 `offset` 为已加载数，返回带 `more`。
- `playlist` 详情、`album`、`artist` 的 `tracks` 目前 app 一次取完（不做分页）；数据大时自行截断并保证 UI 可用。
- 返回 `null` 数组与空数组不同：空数组渲染"空状态"，null 可能显示为加载失败，尽量给空数组。

### 3.5 错误协议与 UI 表现

插件抛错的识别（plugin.go:589-617）：

- 对象带 `code` 字符串：`signIn` → `music.ErrSignIn`（"sign in first"）；`setup` → `ErrSetup`（"the plugin needs setting up"）；`unavailable` → `ErrUnavailable`（"not available"）；`unsupported` → `ErrUnsupported`（"not supported by this source"）；其他 code 用 `message`。
- `message` 或 `code` 可带原因：`music.Fail(kind, reason)` 的语义 = `kind.Error() + ": " + reason`；app 对 `setup` 等会用 `music.Reason(err)` 取冒号后的原因展示（0.1.22 起）。
- 抛出非对象/普通 Error：用 message 当错误文本。

UI 映射（internal/app/sources.go:233-261）：

| 错误 | UI 行为 |
| --- | --- |
| `signIn` | 页面提示 "Sign in to <源名> to see this"；首次弹登录框（每源一次） |
| `setup` | 打开源设置一次；页面显示原因或 "<源名> needs setting up first" |
| `unsupported` | 通用"不支持"提示 |
| 其他 | 显示 `<人话>: <error message>`；动作失败同理 |

约定：

- 需要登录才能做的操作抛 `code: "signIn"`；配置缺失/需要用户填设置抛 `code: "setup"`（message 写清缺什么）；资源不可用（版权下架、地区限制）抛 `code: "unavailable"`。
- **不要把 cookie、Authorization、签名 URL 放进 message、日志、fixtures**（AGENTS.md 硬性要求）。

### 3.6 播放方式：stream vs remote

- `playback: "stream"`（本插件）：app 用 `stream({id, quality})` 拿 `Stream`，自己下载/解码/播放。quality 由设置里的音质项决定（standard/high/lossless），插件按需映射到源站音质；不认识的 quality 回落到 standard 即可。
- `playback: "remote"`：app 把这首歌交给 `remotePlay` 控制其它设备（如 HomePod/手机），本地不下载。需要 `remote*` 系列实现 + `remoteState` 轮询。
- `stream` 返回的 URL 可以是 `http(s)://`（可带签名/时效）或 `file://`（插件目录内文件，demo 用 `file://${host.dir}/tone.mp3`）。
- 播放失败/无版权时也可以返回 URL 但设 `unavailable: true`（UI 置灰）；直接抛 `unavailable` 也可以。

---

## 4. host API

`host` 是全局对象（host.go `installHost`，非 Promise 的接口同步返回）。所有方法在模块顶层同步阶段也可调用（0.1.20 起支持顶层读 storage/settings）。

### 4.1 基本信息

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `host.platform` | `"darwin"\|"linux"\|"windows"` | 运行时 GOOS |
| `host.arch` | `"amd64"\|"arm64"\|...` | 运行时 GOARCH |
| `host.dir` | string | 插件目录绝对路径 |
| `host.dataDir` | string | 插件数据目录绝对路径（`plugin-data/<id>`，已创建，0700） |
| `host.language()` | `"en" \| "zh-CN"` | 当前界面语言（会随用户切换变化） |
| `host.t(text)` | string | 按当前语言翻译：text 是英文 key，查 `locales/<lang>.json`，缺失原样返回 |
| `host.setting(key)` | string | 设置项当前值，未设置 = `""` |

### 4.2 storage

| 方法 | 说明 |
| --- | --- |
| `host.storage.get(key)` | 返回反序列化后的 JSON 值；不存在返回 `undefined` |
| `host.storage.set(key, value)` | 任意 JSON 值 → 写入 `storage.json`（同步落盘），返回 undefined |
| `host.storage.remove(key)` | 删除 key 并写盘 |

storage 是插件私有的持久 KV，适合存 token、设备 id、播放记录等。

### 4.3 用户交互

| 方法 | 签名 / 说明 |
| --- | --- |
| `host.openURL(url)` | 打开默认浏览器；只接受 `http(s)`，否则 reject `not a web address: <url>` |
| `host.signInPrompt(prompt)` | `{qr?: string, text?: string}` 同步调用；把二维码内容/提示文案交给登录对话框；返回 undefined。qr 是**内容**不是图片 URL |
| `host.removeDataDir(name)` | 删除 `host.dataDir` 下名为 `name` 的文件夹；`name` 必须是插件数据目录内的相对名（否则报 `not a folder of the plugin's data: <name>`） |

### 4.4 crypto

| 方法 | 说明 |
| --- | --- |
| `host.crypto.md5(text)` | 返回 32 位小写 hex MD5 |
| `host.crypto.aesEcbEncrypt(key, text)` | AES-ECB + PKCS#7，key 是原始字符串（在其 UTF-8 字节上做 cipher key），返回 hex 字符串；key 长度非法（非 16/24/32 字节）会抛错 |

JS 侧没有 WebCrypto，也没有 `crypto` 全局；需要哈希/加密（如汽水签名）只能用这两个（或自己写纯 JS 实现）。

### 4.5 登录相关的两个高级 API

#### `host.webSignIn({url, cookiesOf, until, userAgent?})` → Promise<{cookie: string}>

打开一个**独立、临时**的登录窗口（关窗即清除 cookie），让用户网页登录，然后轮询 cookie，完成后返回 cookie。

- 前置条件：`plugin.json` 的 `permissions.network` **非空**，否则 reject `webSignIn needs the network permission`。
- `url`：必须是 `https` 且带 host（`not a secure web address to sign in on: <url>`）。
- `cookiesOf`：读 cookie 的 URL，也必须 `https` + host（`cookiesOf isn't a secure web address: <url>`），且必须被 `permissions.network` 允许，否则 `the plugin can't reach <host>, so it can't have its cookies`。
- `until`：**必须**给非空数组，元素是 cookie 名；当这些 cookie 都存在且值非空时认为登录完成（`webSignIn needs the names of the cookies that say it's done, as until`）。不校验值内容。
- `userAgent` 可选，覆盖窗口 UA；登录窗口 pageOptions 使用独立 session（ephemeral），不改全局 cookie。
- 轮询周期 400ms；超时 5 分钟（`Signing in took too long. Try again.`）；用户手动关窗 → `The sign-in window was closed before you finished signing in`。
- 成功返回 `{cookie}`：该 URL 下**所有** cookie 拼成的请求头值（`name=value; name2=value2`，跳过空值），不只是 `until` 里列的。可直接用于后续 fetch 的 `headers: {cookie}`，或写进 `host.storage`，再配合 `requestHeaders` 给图片/音频用。
- 实现依赖 WebView：Linux 无 WebView 构建或主线程不可用时 reject `This computer can't show the page to sign in on`。

#### `host.waitForRedirect({port, path?, timeout?, page?})` → Promise<object>

插件起一个本地 http 服务等待 OAuth 回调（适合需要 `redirect_uri` 的登录）：

- 前置条件：`permissions.network` 非空，否则 `waitForRedirect needs the network permission`。
- `port`：必填整数，监听 `127.0.0.1:<port>`；**不支持 port=0 自动选端口**（插件自己挑一个固定端口）。端口占用会直接 reject。
- `path`：可选；不匹配的路径返回 404 并继续等待。
- 收到匹配请求后：返回 query 参数对象（每个 key 取第一个值，string），1 秒后关闭服务；同时给浏览器回一段纯文本页面，默认 `You're signed in. You can close this page.`（可用 `page` 覆盖）。
- `timeout` 毫秒，`<=0` 或省略 = 5 分钟；超时 reject `timed out waiting for the sign-in to come back`。
- 典型用法：`const {code} = await host.waitForRedirect({port: 38271, path: "/callback"})`，把授权 URL 里的 redirect_uri 设成 `http://127.0.0.1:38271/callback`，再用 `host.openURL` 打开授权页。

### 4.6 启动子进程 `host.spawn`

```js
const proc = await host.spawn("ffmpeg", ["-i", "in.mp4", "out.mp3"]);
```

- 前置：`permissions.process` 非空（`spawn needs the process permission`）**且**用户在设置里 Allow 过（`granted.json`），否则 `the listener hasn't allowed this plugin to start programs`。
- `command` 解析：绝对路径直接用；含 `/` 或 `\` 的相对路径按插件目录解析；否则按程序名在 PATH 查找。必须匹配 `permissions.process` 中某项（`filepath.Match` 语法），否则 `<command> isn't one of the programs in the plugin's process permission`。
- cwd = 插件目录；无控制台窗口；插件关闭/重启时子进程会被杀掉。
- 返回对象：
  - `pid`：number
  - `readLine()` → `Promise<string | null>`：读 stdout 一行（不含换行），EOF 返回 null；单行上限 64 MiB，行数通道 256，读太慢会阻塞子进程 stdout。
  - `write(s)`：写 stdin；`closeStdin()`：关 stdin。
  - `errorOutput()` → string：stderr 最后 8 KiB（也同时写进 app 日志）。
  - `kill()`：杀进程。
  - `wait()` → `Promise<number>`：等待退出，返回退出码（被信号杀可能是负数/非 0）。
- 由于权限很重且跨平台差异大，非必要不用；纯 JS 插件优先用 `fetch` + 本地解码库。

---

## 5. JavaScript 能力边界（moejs v0.1.0-alpha.11）

运行时 = moejs 引擎（Goja 系 JS 引擎）+ `eventloop`（定时器/任务队列）+ `webapi`（Web API）+ mygo 注入的 `host`/`console`。mygo **不安装** `moejs/node`，也没有 CommonJS。

### 5.1 有哪些

- 完整 ECMAScript（ES2024 左右）：`Promise`、`async/await`、`BigInt`、`Proxy`、`Symbol`、`structuredClone`、`queueMicrotask`。
- 编码：`TextEncoder`/`TextDecoder`（**只支持 UTF-8**；其它 label 抛 RangeError）、`atob`/`btoa`。
- 定时器：`setTimeout`/`setInterval`/`setImmediate` 及 clear*；Node 风格 Timeout 对象（ref/unref/refresh/close），delay ≥1ms。回调里再设定时器会进入下一轮。
- Web API（webapi 包）：`fetch`、`Headers`、`Request`、`Response`、`ReadableStream`（及 DefaultReader/Controller）、`WritableStream`、`TransformStream`、`TextEncoderStream`、`TextDecoderStream`、`ByteLengthQueuingStrategy`、`CountQueuingStrategy`、`AbortController`/`AbortSignal`、`DOMException`、`Event`/`EventTarget`、`URL`/`URLSearchParams`、`Performance`、`performance`、`Blob`?（无 Blob/File/FormData，见下）。
- `Intl`（DateTimeFormat/NumberFormat/PluralRules/Locale/Segmenter）；**默认 locale 是 en-US**（mygo 未设置 moejs Locale）。
- 顶层 await：模块顶层用 `await` 合法，加载会先 pending，事件循环起来后继续（`ErrModulePending` 被容忍）。
- 模块语法：`export function xxx() {}`；不能 `import` 其他文件，也没有 `import()`（`moejs.Options.Importer` 为 nil，动态 import 会 TypeError；没有 `require`）。

### 5.2 没有的（容易踩坑）

- ❌ `process`、`Buffer`、`global`、`require`、`module`、`exports`（CommonJS）；`import` 其它文件。
- ❌ `crypto` 全局 / WebCrypto / `crypto.getRandomValues` → 用 `host.crypto` 或纯 JS；随机数可用 `Math.random`（非密码学安全）。
- ❌ `Blob`、`File`、`FormData`、`atob` 之外的文件 API；`response.blob()`、`formData()` 会 reject。
- ❌ `XMLHttpRequest`、`WebSocket`、`EventSource`、`localStorage`、`indexedDB` → 用 `fetch` + `host.storage`。
- ❌ `node:*` 任何模块；`import fs from "node:fs"` 编译期报错/运行期 TypeError。
- ❌ `webcrypto`、`zlib`、`canvas`、DOM（没有 `document`/`window`）。
- ⚠️ 内建对象是**共享且深冻结**的（`Object.freeze(Object.prototype)` 之类）；在严格模式代码里改内建原型会抛 TypeError，非严格可能静默失败。polyfill 只能补**不存在的全局**，不能改内建。
- ⚠️ 内存上限 256 MiB（见 5.3），不是 Node 那样按需增长；大文件/大 JSON 要流式处理。
- ⚠️ 单线程：CPU 密集任务（解密 10MB、zip 解压）会阻塞所有请求；超过 30s 的调用会被判超时，若事件循环 1s 内仍不接任务会被重启。

### 5.3 `fetch` 具体行为（用之前必读）

- 只允许 http/https；`data:`/`file:`/相对 URL 直接 reject。每次请求和每次重定向都会检查 host 是否在 `permissions.network` 内。
- 自定义 `Host` 头可以设置，且会参与权限检查；不能设置 `Cookie`？——可以设置（没有 forbidden header 限制），但没有 cookie jar（app 不设 `Client.Jar`），跨请求 cookie 需自己维护。
- 默认 `redirect: "follow"`，最多 20 跳；`manual` 时返回 3xx 响应（Node 风格，不是 opaqueredirect）；`error` 时遇到 3xx reject。301/302/303 会把非 GET/HEAD 方法变 GET（Go 规则）；跨源重定向会丢掉 `Authorization`/`Cookie`/`Proxy-Authorization`。
- 无 CORS、无缓存、无 preflight；不要依赖浏览器行为。
- Body：`response.body` 是 `ReadableStream<Uint8Array>`，背压有效（不读不下载）；`text()`/`json()`/`arrayBuffer()`/`bytes()` 会一次性读完整个 body（大文件别用）。读取缓冲区 16 KiB 起、逐步到 256 KiB。
- 每个字节都计入内存上限；`Content-Length` 超过上限的响应直接 reject；gzip/deflate 自动解压（brotli 不解）。
- 超时：mygo 的 http.Client 超时 10 分钟，但 30s 调用超时是实际瓶颈；需要长时间下载（如 1 小时播客）不要在一次调用里等它完成——返回 URL 给 app 自己下载。
- 取消：`AbortController` 可取消请求；响应后 `body.cancel()`/`reader.cancel()` 取消底层请求；返回前 reject 的原因是 signal reason（AbortError DOMException 或 TimeoutError）。
- 网络错误：`TypeError: fetch failed`（`cause` 是 Go 错误文本 + `ECONNREFUSED`/`ENOTFOUND` 等 code）；body 中途错误是 `TypeError: terminated`。
- 方法名长度上限 4 KiB；不支持 `FormData` 上传，需要上传就手工拼 JSON/base64。
- `fetch` 的接口签名与 Node/浏览器一致：`fetch(url, {method, headers, body, signal, redirect})`。

### 5.4 内存上限

- 上限 256 MiB，统计"保留的 + 上次重置以来新分配的"（moejs guide）。事件循环在每次任务/定时器回调前重置基线，所以长期运行的插件只要不持续累积就能跑；但单次分配/保留超过剩余预算会触发 *interrupted*：返回 `ErrMemoryLimit`，JS 无法 catch（不会执行 finally），已排队的 Promise job 被丢弃，插件被中断（调用失败）。
- 大于上限的响应 body 永远读不完；返回 URL 给 app 下载才是正确做法。
- 避免把整个音频/图片塞进 JS 内存；解析 JSON 时用流式读取（`response.body` reader + TextDecoder incremental）。

---

## 6. stream 行为（音频播放）

### 6.1 拿流

`stream({id, quality})` 返回 `Stream`。app 随后（internal/player/stream.go）：

1. `GET Stream.url`，请求头 = `User-Agent: MyGoMusic/1.0` + `Stream.headers`（`requestHeaders` 音频规则只补缺失项）；**不发 Range**，不跟随插件外的 header 到第三方 host（跨 host 重定向会删插件头，最多 10 跳）。
2. 响应必须是 200（否则报 `<status>`），边走边写缓存/内存。
3. 用**前 12 个字节嗅探容器**，与 `Stream.type` 无关：`head[4:8] == "ftyp"` → MP4 家族（ALAC/FLAC/AAC，0.1.21 起支持**分片 MP4** 边下边播）；`RIFF`/`RF64`+`WAVE` → WAV；跳过 ID3 后 `fLaC` → FLAC、`OggS` → Ogg、ADTS 头 → AAC；否则按 MP3。
4. 播放器按容器解码；缓存文件用 `Stream.type` 命名扩展名。

因此：

- **0.1.21+ 可以直接返回 DASH/fMP4 分片 URL**，app 边下边播，插件不需要转码/拼接。
- 返回 `.m4a`/`.aac` 时长 MP4 或 ADTS 都可以（type 填 `m4a`/`aac` 供缓存命名）。
- 不支持 HLS 播放列表（`.m3u8` 文本不会是音频）；如果源只给 m3u8，需插件自己解析出分片 URL 并给 fMP4/MP3 直链，或返回第一个分片（不推荐）。
- URL 可以是 `file://`（插件目录内），适合 demo/本地缓存文件。

### 6.2 缓存与 Size/Quality

- 缓存 key = `sha256(source + "\0" + id)` 前 16 hex + `-` + quality；目录在用户数据目录（app 管理）。
- 只有 `quality ∈ {standard, high, lossless}` **且** `type ∈ {mp3, flac, ogg, wav, m4a, aac}` 才可缓存；`type` 缺省按 `mp3` 处理。
- `Stream.size` 用于预分配（上限 32 MiB 预分配）与"缓存文件大小 == size"的完整性判断：**填错会导致缓存作废重复下载**（不影响本次播放）；不确定就省略。
- 缓存文件只在"下载完整 + 大小匹配 + 可缓存"时保留；否则下次重新下载。下载到内存的流不占插件内存（是 Go 侧内存），但插件自己的 `fetch` 读 body 才占。
- `quality == "lossless"` 或 `type` 为 `flac`/`wav` 时 UI 显示 "Lossless" 徽标；`bitRate` 目前不用。
- `gain`/`peak`：若都非 0 则做 ReplayGain 音量调整（`g = 10^((gain+preamp)/20)`，峰值限制 `min(g, 1/peak)`）；不要乱填，否则音量异常。

### 6.3 推荐做法（汽水这类 API）

- `stream` 里只做"取播放地址"的网络请求（通常 1-2 次），把 URL 交给 app；**不要**在 JS 里下载音频再转 base64。
- 若音源要求 cookie/authorization 头，用 `Stream.headers` 返回；app 会带上并在跨 host 重定向时自动剥离。
- 若音源是 DASH/fMP4（0.1.21+），直接返回分片 URL；`minAppVersion` 应 ≥ `0.1.21`。
- 会员/版权限制：`unavailable: true` 或抛 `code:"unavailable"`，不要返回无效 URL 让播放器报错。

---

## 7. 日志与排错

- 插件 `console.log/info/warn/error` 都走 Go 标准 log：`plugin <id>: <参数用空格拼 String() 的结果>`。对象会变成 `[object Object]`，调试时请 `JSON.stringify`。
- 插件运行时错误（未捕获异常、eventloop OnError）也写同一 log：`plugin <id>: ...`。
- **没有日志文件**：app 未设置 log 输出，默认 stderr。macOS 从 Finder 启动时 stderr 是 `/dev/null`（已实测），看不到日志。
- 看日志的方法：退出 app，然后终端运行：

```bash
"/Applications/MyGo Music.app/Contents/MacOS/MyGo Music"
```

  再在 app 里操作插件，日志直接打印到终端。日志里出现 `plugin <id>: stuck; restarting it` 表示插件卡死被重启（常为死循环或长时间同步计算）。

- 用户数据目录：`~/Library/Application Support/MyGo Music/`（`plugins/`、`plugin-data/<id>/`）。直接改 `plugin-data/<id>/storage.json` 可重置登录态（先退出 app）。
- 卸载插件：设置 → 源 → 移除；插件文件夹进废纸篓，插件数据保留。

---

## 8. 测试脚手架（tools/harness/）

仓库内 `tools/harness/` 提供无头回归工具，用于在没有 MyGo app 的情况下验证 `index.js` 的导出结构（不是完整运行时模拟）。

### 8.1 纯 JS 结构校验（默认，快速）

```bash
# 校验当前仓库插件（自动读取 plugin.json 的 main）
node --experimental-vm-modules tools/harness/run.mjs --plugin .

# 只跑部分导出、打印详情
node --experimental-vm-modules tools/harness/run.mjs --plugin . --only home,search,stream --verbose

# 指定 mock 设置（模拟 host.setting 的值）
node --experimental-vm-modules tools/harness/run.mjs --plugin . --setting server=api.example.com --setting quality=lossless

# 自检 harness 自身（契约校验器 + mock-plugin）
node --experimental-vm-modules tools/harness/selftest.mjs
```

工作方式：

- 用 Node 的 `vm.SourceTextModule` 在**隔离 vm context** 里加载插件的 `main`，context 只注入 moejs/webapi 里存在的全局（`fetch`/`Headers`/`Response`/`ReadableStream`/`TextDecoder`/`TextEncoder`/`AbortController`/`URL`/`console`/定时器/`host` 等），**故意不提供** Node 的 `process`/`Buffer`/`crypto`/`require`/`import`——若插件误用 Node API，会立刻在 harness 里报错。
- `host` 是 mock：`storage` 在内存里、`setting` 来自 `--setting`、`host.t` 原样返回、`webSignIn`/`spawn` 等抛"harness 不支持"。
- `fetch` 是 mock：从 `tools/harness/fixtures/routes.json` 匹配 method + URL（子串/正则），返回预置 JSON/文件；未匹配的请求记录为 unhandled 并返回 404。用于喂汽水夹具（不含真实签名/凭证）。
- 每个导出调用带超时（默认 10s），结果按 `lib/contract.mjs` 的 JSON 结构校验器检查字段类型/必填/嵌套，输出 errors 与 warnings。
- 覆盖的导出：`home`、`search`（5 种 kind）、`stream`、`account`、`playlists`、`playlist`、`album`、`artist`、`liked`、`savedAlbums`、`shows`、`show`、`lyrics`、`comments`、`suggest`、`recent`、`isLiked`、`stations` 等；未实现的（抛 unsupported 或未导出）标记为 SKIP 不算失败，`--strict` 下未导出的必需项算失败。
- **不能验证**：真实网络、真实登录（webSignIn）、真实播放（解码/fMP4）、host 的 Go 实现语义、内存上限、moejs 与 Goja 的细节差异（比如同样的 JS 在 Goja 里可能行为不同——harness 用 Node，属于近似）。

### 8.2 Go 真实运行时冒烟（可选，需要 Go + mygo-music 源码）

```bash
# 默认用 /tmp/qsresearch/mygo-music 的源码，参数是插件目录
tools/harness/go/run-go.sh .
# 源码在别处时：
MYGO_SRC=/path/to/mygo-music tools/harness/go/run-go.sh .
```

- 把 mygo-music 源码复制到临时目录，注入 `internal/plugin/harness_test.go`，在真实 `plugin.Load` 下加载本插件：断言 `plugin.json` 能解析、id/main 合法、`Can("home"/"search"/"stream")` 为 true、`Info()` 正常（**不启动 JS 运行时**）。
- 局限：它只验证加载期（manifest/语法/导出名），不执行插件 JS，因此发现不了运行期错误；执行期的结构校验见 8.1。

### 8.3 与真实 app 的差异 / 测试边界

| 项 | harness | 真实 app |
| --- | --- | --- |
| JS 引擎 | Node V8 | moejs（Goja） |
| fetch | 路由表 mock | Go net/http + 权限 host 检查 |
| host.* | 内存 mock | Go 实现 |
| 播放 | 不播放 | 真实解码 |
| 登录 | 不支持 | WebView |
| 插件加载/权限校验 | 只读 plugin.json | 完整 Load + minAppVersion |

结论：harness 用来**抓结构错误、字段漏填、Node API 误用、明显异常返回值**；上线前仍要在 app 里真机跑一遍 home/search/stream/登录。

---

## 9. 未确认项 / 风险

以下为核对后仍不确定或依赖版本的点（写插件时按保守方式处理）：

1. **官方无插件文档**：本文全部来自 0.1.22 源码 + examples/demo-plugin + 本机实测；没有网站/README 契约，未来小版本可能变化（以 install 的 `minAppVersion` 为准）。
2. **`moejs` 默认 locale**：代码未设置 `moejs.Options.Locale`，推断为 en-US；`Intl` 输出可能与系统语言不同。
3. **`response.blob()`/`formData()` 的具体错误**：webapi 未实现 Blob/File/FormData，调用会 reject，但错误文案未逐一实测。
4. **`fetch` 的 10 分钟 Client 超时 vs 30s 调用超时**：长时间下载必然被调用超时打断；但"30s 内只启动不等待"的 fetch 是否会被 app 取消未实测（插件返回前应避免遗留后台 fetch）。
5. **`Intl`/`structuredClone` 在 Goja 的具体实现完整度**：moejs 文档称支持，但边界未逐项测。
6. **`host.webSignIn` 返回的 cookie 是否包含 HttpOnly**：app 通过 session.Cookies.List 取（Go 侧能拿到 HttpOnly cookie 的值），返回的是完整 cookie 头，HttpOnly 不影响；但**登录完成判断只看 cookie 存在**，不校验值，若源站提前种同名空 cookie 可能误判（已要求非空值）。
7. **`host.spawn` 的退出码语义**：被信号终止时 Go 的 ExitCode 可能是 -1；`wait()` 返回该值。
8. **`Stream.headers` 的 `Referer`**：app 不自动设置 Referer，需要就自己填；跨 host 重定向会被删。
9. **`requestHeaders` 的 `{storage:key}` 在 key 为对象时**：按 JSON 文本发送（会有引号），一般只应存字符串。
10. **0.1.22 的 fMP4**：0.1.21 起支持，但 `plugin.json` 的 `minAppVersion` 需要自己提到 `0.1.21`；本仓库当前是 `0.1.20`，如果汽水音频是 fMP4/DASH，请 Lead 决策是否提升。
11. **harness 的 Node 版本要求**：`vm.SourceTextModule` 需要 `--experimental-vm-modules`（Node 26 已验证）；Node 18-24 也支持该 flag，但未逐一测试。
12. **app 的插件日志文件**：确认无日志文件、Finder 启动时 stderr 不可见；若未来版本加了日志，以版本为准。

---

## 附录 A：最小插件骨架

```json
{
  "id": "example",
  "name": "Example",
  "version": "0.1.0",
  "minAppVersion": "0.1.21",
  "main": "index.js",
  "playback": "stream",
  "permissions": {"network": ["api.example.com"], "process": []},
  "navigation": [
    {"builtin": "home", "title": "Home", "icon": "home"},
    {"builtin": "liked", "title": "Liked", "icon": "heart"}
  ]
}
```

```js
export async function home() {
  return {
    title: "Example",
    sections: [{ title: "Hot", tracks: [] }],
  };
}

export async function search({ query, kind, offset }) {
  if (kind !== "tracks") return { more: false };
  const resp = await fetch("https://api.example.com/search?q=" + encodeURIComponent(query) + "&offset=" + offset);
  if (!resp.ok) throw new Error("search failed: " + resp.status);
  const data = await resp.json();
  return {
    tracks: data.tracks.map((t) => ({
      id: String(t.id),
      name: t.name,
      artists: [{ id: String(t.artist.id), name: t.artist.name }],
      album: { id: String(t.album.id), name: t.album.name, imageUrl: t.album.cover },
      duration: t.duration_ms,
    })),
    more: data.more === true,
  };
}

export async function stream({ id, quality }) {
  const t = await host.storage.get("token");
  if (!t) {
    const err = new Error("signIn");
    err.code = "signIn";
    throw err;
  }
  const resp = await fetch("https://api.example.com/stream?id=" + encodeURIComponent(id), {
    headers: { cookie: t },
  });
  if (!resp.ok) throw new Error("stream failed: " + resp.status);
  const data = await resp.json();
  return {
    url: data.url,
    type: "m4a",
    quality: quality === "lossless" ? "lossless" : "high",
    headers: data.headers,
  };
}
```

## 附录 B：demo-plugin 参考（MIT，examples/demo-plugin）

mygo-music 源码 `examples/demo-plugin/` 是官方示例（MIT）：`plugin.json`（id `demo`，playback `stream`，settings + navigation 示例）、`index.js`（导出所有 Source 方法、错误码、storage/settings、`host.t`、file:// stream、LRC + 逐字歌词）、`locales/zh-CN.json`、`tone.mp3`。写新插件时可对照它的调用形态，但**不要复制它的演示数据**。

## 附录 C：自检清单（提交前）

- [ ] `plugin.json`：id/name/version/minAppVersion/main/playback/permissions 齐全；network 只列需要的 host；`*.domain` 与 apex 分开写。
- [ ] 每个导出返回字段名拼写正确（camelCase）；`Track` 有 `album`；`duration` 是毫秒；`more` 最后一页为 false。
- [ ] 插件顶层不 import、不 require、不用 Node/Buffer/process/crypto；随机/哈希用 `host.crypto`。
- [ ] 错误用 `code` 协议；message 不含 token/cookie/签名 URL。
- [ ] `stream` 不下载音频本体；`Stream.type`/`size`/`headers` 合理；fMP4 时 minAppVersion ≥ 0.1.21。
- [ ] 在 app 里手动验证 home/search/stream/歌词/登录；`node --experimental-vm-modules tools/harness/run.mjs --plugin .` 通过。
