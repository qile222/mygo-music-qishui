# MyGo Music 插件无头测试脚手架

`docs/RUNTIME.md` 的配套工具。在 Node 里用隔离的 vm 上下文加载插件的 `index.js`，mock 掉 `host` 与 `fetch`，
再按 MyGo Music 0.1.22 的 `music.Source` 契约校验每个导出函数的返回结构。不播放音频、不启动 App，
几秒内跑完，适合实现 `index.js` 后快速回归。

## 前置

- Node.js >= 18（实测 v26.13.0）
- 必须以 `--experimental-vm-modules` 运行（`vm.SourceTextModule` 仍是实验特性；不带 flag 会直接给出提示）
- 无需安装任何 npm 依赖

## 快速开始

```sh
# 在仓库根目录：严格校验 home/search/stream
node --experimental-vm-modules tools/harness/run.mjs --plugin . --only home,search,stream --strict

# 跑全部导出（插件未导出的方法记为 SKIP）
node --experimental-vm-modules tools/harness/run.mjs --plugin .

# 看 mock 请求、插件 console 输出与 warning
node --experimental-vm-modules tools/harness/run.mjs --plugin . --verbose

# 机器可读报告
node --experimental-vm-modules tools/harness/run.mjs --plugin . --json
```

退出码：0 = 全部 PASS/SKIP；1 = 有 FAIL 或 plugin.json 无效；2 = harness 自身错误（参数、加载异常）。

## 输出怎么读

```
  home            PASS   3ms    2 section(s), title="汽水音乐"
  search[albums]  FAIL   1ms   result.albums[0].id: required non-empty string
  shows           SKIP   0ms   not exported
```

- PASS：函数返回了可 JSON 序列化的值，且通过 `docs/RUNTIME.md` §3.3 的字段校验
- FAIL：抛错、超时（默认 10s）、返回值不可序列化或不符合契约
- SKIP：方法未导出；或抛出的错误 code 为 `signIn` / `unsupported`（表示这台机器上做不到，属合法实现）
- `--strict` 额外要求 home/search/stream 必须存在（缺一个即 FAIL），且所有 fetch 都要有 mock 路由
- `--only home,search,stream` 只跑指定导出；`--timeout 20000` 放宽单次调用超时

## 错误 code

插件抛出的 Error 若带 `code` 属性，按 MyGo 约定识别：`signIn` → SKIP（需要登录，mock host 登录不了）；
`unsupported` → SKIP；其余（含 `setup`/`unavailable`/普通 Error）→ FAIL，说明 fixture 或实现有问题。
所以“未登录先抛 signIn、mock 环境跳过”是合法写法；而把网络错误包装成 `unsupported` 来逃避测试则会被看穿。

## mock 数据：routes.json

`fetch` 由 `fixtures/routes.json` 驱动；未匹配的请求返回 404 JSON，并在报告里列入 “fetch requests without a mock route”。

```json
{
  "routes": [
    { "url": "api.example.com/home", "json": { "title": "Home", "sections": [] } },
    { "urlRegex": "api\\.example\\.com/search\\?.*kind=albums", "json": { "albums": [] } },
    { "url": "api.example.com/stream", "json": { "url": "https://cdn.example.com/1.m4a", "type": "m4a" } },
    { "url": "api.example.com/slow", "delayMs": 100, "json": {} },
    { "url": "api.example.com/old", "status": 302, "headers": { "location": "https://api.example.com/new" } }
  ]
}
```

- 路由按数组顺序匹配，先到先得；`method` 可选（默认任意方法）
- 响应来源三选一：`json`（对象自动字符串化）、`body`（字符串）、`file`（相对 routes 文件目录）
- 可加 `status`、`headers`、`delayMs`；`error: true` 模拟网络错误（TypeError: fetch failed）
- 不做真实重定向跟随；要测 301/302 就显式写两条 route。真机 0.1.19+ 会跟随重定向并清理跨 host 的插件头
- `tools/harness/fixtures/routes.json` 只是 demo；换真实接口用 `--routes path/to/qishui.json`（由 fixtures 负责人维护，切勿提交 Cookie/Authorization）

当前仓库的 `index.js` 会真实请求 `beta-luna.douyin.com`。没有对应 fixture 时全部 FAIL 属正常，
补上 routes 之后即可验证返回结构；结构问题会精确到字段路径。

## mock host 能做什么

`host.platform/arch/dir/dataDir/storage/language()/t()/setting()/openURL/signInPrompt/`
`crypto.md5/crypto.aesEcbEncrypt/removeDataDir` 都按 0.1.22 的行为 mock：`storage` 是内存版（缺失 key 返回 `undefined`），
`--setting k=v` 注入 `host.setting()`，`--language zh-CN` 改 `host.language()`（默认 zh-CN），`host.t()` 读插件 `locales/<lang>.json`。
`host.webSignIn/waitForRedirect/spawn` 直接抛 “not available (needs the real MyGo runtime)”，因为它们依赖真实 WebView/进程权限。

## 隔离环境里故意没有的东西

为了提前发现“只在 Node 能跑、真机跑不了”的写法，vm 上下文**不注入**：`process`、`Buffer`、`require`、
`import()`/`import.meta`、`crypto`（getRandomValues/subtle）、`node:*` 模块。动态 `import` 会明确报错
“a MyGo plugin is a single module; import is not available”。这与 0.1.22 的 moejs 环境一致：
单文件 ESM、无 import、无 Node API，只有 fetch/URL/Streams/TextDecoder/AbortController 等 webapi 全局。

## 能验证什么 / 不能验证什么

能：
- 导出是否存在、模块能否在无 Node API 的环境求值（含顶层 await）
- 每个导出返回值的字段/类型/枚举（`docs/RUNTIME.md` §3.3）、分页 `more`、`stream` 的 URL/type/headers
- 该抛 signIn/unsupported 还是普通错误，mock fetch 是否命中预期接口

不能（必须在 app 里手动确认）：
- 真实网络、`permissions.network`、`requestHeaders` 拦截与 `{setting:}`/`{storage:}` 占位符替换
- 播放链路：容器嗅探（fMP4/FLAC/ALAC/WAV）、缓存 `Size` 校验、跨 host 重定向删头、ReplayGain
- `webSignIn`/`waitForRedirect`/`spawn`、QR 登录、设置页/导航/UI
- moejs（Goja）与 Node V8 的语义差异、256MiB 内存上限、真机 30s callTimeout

## 自检

```sh
node --experimental-vm-modules tools/harness/selftest.mjs
```

先跑契约 validator 的正反例，再端到端跑 `mock-plugin`（必须 OK），最后跑一个故意用 `Buffer` 的坏插件（必须 FAIL）。
改动 harness 之后先跑这个。

## Go 冒烟：真实 plugin.Load

```sh
tools/harness/go/run-go.sh .
MYGO_SRC=/path/to/mygo-music tools/harness/go/run-go.sh .
```

把 mygo-music 源码复制到临时目录，在 `internal/plugin` 注入测试：用真实 `plugin.Load` 加载插件目录，
断言 manifest 可解析、id/main 校验、模块编译通过、`Can("home"/"search"/"stream")` 为 true。
它不启动 JS runtime（不执行插件代码），因此不需要 mock；用来抓 plugin.json/语法/导出名错误。
需要本机有 mygo-music 源码（默认 `/tmp/qsresearch/mygo-music`）和 Go 工具链，只读引用 MIT 代码，不改源码。

## 文件

```
run.mjs                 CLI（文本/JSON 报告，exit code）
selftest.mjs            harness 自检
lib/loader.mjs          vm 加载、全局注入、超时
lib/mock-host.mjs       host 全局 mock
lib/mock-fetch.mjs      routes 驱动的 fetch mock
lib/contract.mjs        plugin.json 与所有返回结构的 validator
mock-plugin/            自检用 mock 插件（fetch + host.storage）
fixtures/routes.json    demo routes
go/run-go.sh            真实 loader 冒烟入口
go/harness_test.go.tmpl 注入 internal/plugin 的测试模板
```

契约细节以 `docs/RUNTIME.md` 为准；本工具只覆盖静态结构，不能替代真机验证。
