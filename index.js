// SPDX-License-Identifier: MIT
// 汽水音乐 — MyGo Music 插件（单文件、纯 JavaScript）
//
// 没有构建步骤、不需要安装 Node/Electron：把整个文件夹（或 zip）装进 MyGo Music
// 即用。macOS 上为了完整播放曲目，只启动两个本机已有的程序：系统自带的
// /usr/bin/base64（把解密后的音频写进插件数据目录），以及官方汽水音乐客户端自带的
// Electron 运行时（只用来调用官方签名模块，见下方「官方签名」一节）。Windows / Linux
// 上不启动任何外部程序，也不做音频解密：浏览、搜索、歌词和普通曲目播放可用，会员完整
// 音频与写操作暂不支持。所有数据都来自汽水音乐客户端接口；写操作实现喜欢/取消喜欢、
// 歌单编辑、收藏与关注，不实现评论；也不绕过 VIP/付费限制：只有试听片段的曲目由接口
// 原样返回，App 会按返回的时长播放。
//
// MyGo 在持有 storage 锁时加载模块，所以模块顶层不能调用 host：host.storage、
// host.signInPrompt 只出现在导出函数内部第一次使用时。

const APP = "https://beta-luna.douyin.com";
const PC = "https://api.qishui.com";
const APP_UA = "Luna/19.1.0 Android";
const PC_UA = "LunaPC/3.0.0(290101097)";
const WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
// iid 只是匿名请求的客户端标识，不含账号信息；每次加载随机生成，避免携带固定设备标识。
const APP_PARAMS = {
  aid: "386088",
  device_platform: "android",
  version_code: "30020100",
  iid: randomDigits(15),
};
const PC_PARAMS = { aid: "386088", device_platform: "pc", version_code: "30020100" };
const PASSPORT_PARAMS = {
  passport_jssdk_version: "2.4.13",
  passport_jssdk_type: "normal",
  is_from_ttaccountsdk: "1",
  aid: "386088",
};
const SEARCH_PAGE = 20;
const PAGE_SIZE = 50;
const PLAYLIST_LIMIT = 500;
const LIKED_LIMIT = 1000;
const SIGN_IN_DEADLINE = 4 * 60 * 1000;

// ---------- 基础工具 ----------

// fail 带上宿主认识的 code：signIn 提示登录、unavailable 说明不可播、
// unsupported 说明这个来源不做、setup 让用户去看设置。
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asID(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!/^\d{1,20}$/.test(text)) throw new Error("无效的汽水音乐 ID");
  return text;
}

function pageOffset(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function dateText(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

// 汽水返回的 ID 是 19 位整数，超出 JS 安全整数范围。先给超长整数字面量加引号再
// JSON.parse，否则 ID 会被四舍五入成另一个曲目/歌单。
function parseData(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        const c = text[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === '"') break;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      // 扫描完整的数字 token（含小数和指数），只给“纯整数且 >=16 位”加引号。
      // 如果只扫整数部分，浮点小数部分会被当成新数字误加引号，变成 0."123...”
      let j = i + (ch === "-" ? 1 : 0);
      while (j < n && text[j] >= "0" && text[j] <= "9") j++;
      let plainInteger = true;
      if (text[j] === ".") {
        plainInteger = false;
        j++;
        while (j < n && text[j] >= "0" && text[j] <= "9") j++;
      }
      if (text[j] === "e" || text[j] === "E") {
        plainInteger = false;
        j++;
        if (text[j] === "+" || text[j] === "-") j++;
        while (j < n && text[j] >= "0" && text[j] <= "9") j++;
      }
      const starts = i + (ch === "-" ? 1 : 0);
      const digits = plainInteger ? j - starts : 0;
      if (plainInteger && digits >= 16) {
        out += '"' + text.slice(i, j) + '"';
      } else {
        out += text.slice(i, j);
      }
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return JSON.parse(out);
}

// 图片地址：汽水的封面是 {uri, urls, template_prefix}，拼出带 {size} 占位的
// CDN 模板，由 App 替换成实际像素；头像等已经是完整 URL 的对象直接用 urls[0]。
function coverURL(raw, size) {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return coverURL(raw[0], size);
  const base = raw.urls && raw.urls[0] ? String(raw.urls[0]) : "";
  const uri = raw.uri ? String(raw.uri) : "";
  if (uri && base) {
    const prefix = raw.template_prefix ? String(raw.template_prefix) : "";
    if (prefix) return base + uri + "~" + prefix + "-resize:{size}:{size}.webp";
    return base + uri;
  }
  if (raw.url) return String(raw.url);
  if (raw.uri_url) return String(raw.uri_url);
  return base;
}

function queryString(params) {
  const parts = [];
  for (const key of Object.keys(params || {})) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
  }
  return parts.join("&");
}

function cookieHeader(cookies) {
  const parts = [];
  for (const name of Object.keys(cookies || {})) {
    if (cookies[name]) parts.push(name + "=" + cookies[name]);
  }
  return parts.join("; ");
}

function acceptCookies(response, jar) {
  if (!jar || !response || !response.headers) return;
  let lines = [];
  try {
    if (typeof response.headers.getSetCookie === "function") {
      lines = response.headers.getSetCookie() || [];
    }
  } catch (error) {
    return;
  }
  for (const line of lines) {
    if (typeof line !== "string") continue;
    const pair = line.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const maxAge = /;\s*max-age\s*=\s*(-?\d+)/i.exec(line);
    const expires = /;\s*expires\s*=\s*([^;]+)/i.exec(line);
    let expired = false;
    if (maxAge) expired = Number(maxAge[1]) <= 0;
    else if (expires) {
      const at = Date.parse(expires[1]);
      expired = Number.isFinite(at) && at <= Date.now();
    }
    if (!value || expired) delete jar[name];
    else jar[name] = value;
  }
}

// ---------- 会话 ----------
// 保存的是汽水登录后的 Cookie 和账号资料，只在插件自己的数据目录里。

let session = null;
let epoch = 0;
let discoverCache = null;
let likedCache = null;
let feedModeCache = null;
let discoverMixCache = null;
let discoverRadioCache = null;
let songTabCache = null;
const STATION_CACHE_MS = 5 * 60 * 1000;
const stationStates = {};

function currentSession() {
  if (!session) {
    const saved = host.storage.get("session");
    session = saved && typeof saved === "object" ? saved : {};
    if (!session.cookies || typeof session.cookies !== "object") session.cookies = {};
    if (!session.profile || typeof session.profile !== "object") session.profile = null;
    session.signedIn = session.signedIn === true;
  }
  return session;
}

function signedIn() {
  const active = currentSession();
  return active.signedIn === true && Object.keys(active.cookies).length > 0;
}

function persistSession() {
  const active = currentSession();
  if (active.signedIn) {
    host.storage.set("session", {
      cookies: active.cookies,
      profile: active.profile,
      signedIn: true,
    });
  } else {
    host.storage.remove("session");
  }
}

function clearSession() {
  epoch++;
  session = { cookies: {}, profile: null, signedIn: false };
  discoverCache = null;
  likedCache = null;
  host.storage.remove("session");
}

function checkEpoch(startedEpoch) {
  if (startedEpoch !== epoch) throw new Error("账号状态已改变，请重试");
}

// ---------- HTTP ----------
// 所有请求都在导出函数里发生。响应体可能很大（首页 discover 约 1.5 MB），这里
// 统一用 text() 读取再交给防止 ID 失真的 parseData。

async function fetchText(url, options) {
  const opts = options || {};
  const headers = { "User-Agent": opts.ua || APP_UA, Accept: "application/json, text/plain, */*" };
  const jar = opts.jar === undefined ? currentSession().cookies : opts.jar;
  if (jar && Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
  const init = { method: opts.method || "GET", headers, redirect: "error" };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  } else if (opts.form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = opts.form;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 15000);
  init.signal = controller.signal;
  let response;
  let text = "";
  try {
    response = await fetch(url, init);
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("汽水音乐请求超时，请稍后重试");
    throw new Error("无法连接汽水音乐，请检查网络或系统代理后重试");
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw fail("signIn", "汽水音乐登录状态已失效，请重新扫码登录");
  }
  if (!response.ok && !opts.allowStatus) {
    throw new Error("汽水音乐请求失败（HTTP " + response.status + "）");
  }
  if (jar) acceptCookies(response, jar);
  return text;
}

function payloadFrom(text) {
  const data = text ? parseData(text) : {};
  if (!data || typeof data !== "object") throw new Error("汽水音乐返回了无法识别的响应");
  const code = data.status_code === undefined ? 0 : Number(data.status_code);
  if (code === 1000016) throw fail("signIn", "汽水音乐登录状态已失效，请重新扫码登录");
  if (code && code !== 200) {
    const info = data.status_info || {};
    const message = String(info.status_msg || "");
    if (message === "ERR_INVALID_PARAM") {
      throw new Error("汽水音乐没有接受这次请求的参数，请稍后重试");
    }
    throw new Error(
      message && message !== "success"
        ? "汽水音乐接口返回错误：" + message
        : "汽水音乐接口返回错误，请稍后重试"
    );
  }
  return data;
}

async function luna(path, options) {
  const opts = options || {};
  const params = {};
  for (const key of Object.keys(APP_PARAMS)) params[key] = APP_PARAMS[key];
  for (const key of Object.keys(opts.params || {})) params[key] = opts.params[key];
  const url = APP + path + "?" + queryString(params);
  const text = await fetchText(url, {
    ua: opts.ua || APP_UA,
    method: opts.body === undefined ? "GET" : "POST",
    body: opts.body,
    jar: opts.jar,
    timeoutMs: opts.timeoutMs,
  });
  return payloadFrom(text);
}

async function pc(path, options) {
  const opts = options || {};
  const params = {};
  for (const key of Object.keys(PC_PARAMS)) params[key] = PC_PARAMS[key];
  for (const key of Object.keys(opts.params || {})) params[key] = opts.params[key];
  const url = PC + path + "?" + queryString(params);
  const text = await fetchText(url, {
    ua: PC_UA,
    method: opts.body === undefined ? "GET" : "POST",
    body: opts.body,
    jar: opts.jar,
    timeoutMs: opts.timeoutMs,
  });
  return payloadFrom(text);
}

// ---------- 平台 ----------
// 完整播放（track_v2）与写操作都依赖官方客户端的 macOS 签名模块，所以这些能力只在
// macOS 上启用；Windows / Linux 不启动任何外部程序，只走匿名网页接口，能浏览、搜索、
// 看歌词、播放普通曲目（会员曲目只有 30–60 秒试听，不解密）。
const MAC_PLATFORM = "darwin";
const PLATFORM_MESSAGE =
  "完整播放和写操作目前只支持 macOS：需要本机安装官方汽水音乐客户端并允许插件启动程序。" +
  "Windows/Linux 上可以浏览、搜索、查看歌词和播放普通曲目。";
let platformCache = "";

function platformName() {
  if (!platformCache) {
    let value = "";
    try {
      value = String(host.platform || "");
    } catch (error) {
      value = "";
    }
    platformCache = value || MAC_PLATFORM;
  }
  return platformCache;
}

function onMac() {
  return platformName() === "darwin";
}

// host.dataDir 在 Windows 上是反斜杠路径，直接拼 "/" 会拼出非法路径。
function dataPath(name) {
  const dir = String(host.dataDir || "");
  if (!dir) return name;
  const last = dir.charAt(dir.length - 1);
  if (last === "/" || last === "\\") return dir + name;
  const windows = platformName() === "win32" || (dir.indexOf("\\") >= 0 && dir.indexOf("/") < 0);
  return dir + (windows ? "\\" : "/") + name;
}

// file:// URL：Windows 盘符要写成 file:///C:/...，空格和非 ASCII 交给 encodeURI，
// ? 和 # 必须单独转义，否则会被当成 URL 的 query / fragment。
function fileURLFor(path) {
  const normalized = String(path).replace(/\\/g, "/");
  const escaped = encodeURI(normalized).replace(/\?/g, "%3F").replace(/#/g, "%23");
  if (/^[A-Za-z]:\//.test(escaped)) return "file:///" + escaped;
  return escaped.charAt(0) === "/" ? "file://" + escaped : "file:///" + escaped;
}

// ---------- 官方签名（track_v2 需要 X-Helios + X-Medusa） ----------
// 2026-11-09 起，汽水对 PC 的 track_v2 强制校验官方请求签名，未签名的 POST 直接返回空
// body。签名头里的 X-Helios 由混淆的原生代码（libMetaSecML.dylib）生成，纯 JS 复刻不了；
// 这里不安装 Node/Electron，而是用本机已安装的汽水音乐官方客户端自带的 Electron 运行时
// （ELECTRON_RUN_AS_NODE=1）加载它自己的 bdms.node 来签名，客户端升级时自动跟随最新版本。

const SIGNED_PC_UA = "LunaPC/3.7.0(452316191)";
const SIGNER_BIN = "/usr/bin/env";
const SIGNER_APPS = [
  "/Applications/汽水音乐.app/Contents/MacOS/汽水音乐",
  "/Applications/SodaMusic.app/Contents/MacOS/SodaMusic",
  "/Applications/汽水音乐.app/Contents/MacOS/SodaMusic",
  "/Applications/SodaMusic.app/Contents/MacOS/汽水音乐",
];
const DEVICE_KEY = "device";
const HISTORY_PATH = "/luna/pc/me/recently-played-media";
const COLLECTION_ROOT = "/luna/pc/me/collection";
const OWN_PLAYLIST_PATH = "/luna/pc/me/playlist";
const SORT_PATH = "/luna/me/playlist/media/sort";
// 只有「普通歌单」能改名/删歌/排序；type 1（我喜欢的音乐）、type 4（抖音收藏的音乐）
// 等由汽水自己管理，固定不可编辑。
const ORDINARY_PLAYLIST_TYPES = [2, 3, 11];
const COLLECTION_CACHE_MS = 60 * 1000;
const COLLECTION_LIMIT = 500;
const SAVED_ALBUMS_PAGE = 30;

// 收藏的歌单 / 专辑、关注的艺人只能从签名接口读，缓存一分钟，同一次浏览里不重复签名。
let collectionCache = {};

// 常驻签名进程：第一次播放时启动一次官方客户端自带的 Electron（冷启动约 4 秒），
// 之后每首歌只走 stdin/stdout 一行，签名只要几毫秒；App 退出时 stdin 关闭，进程
// 随即退出，不会留下孤儿进程。
let signerApp = "";
let signerProc = null;
let signerStarting = null;
let signerQueue = Promise.resolve();
let signerRequestId = 0;

// 下面这段会被官方客户端的 Electron 当 Node 执行：stdin 每行一个
// {id, url, headers, deviceId}（或 {id, warm: true} 只做初始化），用官方 bdms.node
// 签名，stdout 回一行 {id, "x-helios":..., "x-medusa":...} 或 {id, error}。
const SIGNER_SOURCE = [
  'const fs = require("fs");',
  'const path = require("path");',
  'const os = require("os");',
  'const readline = require("readline");',
  'const CRLF = String.fromCharCode(13, 10);',
  'function findBdms() {',
  '  const roots = [',
  '    path.join(os.homedir(), "Library/Application Support/SodaMusic/Packages"),',
  '    path.join(os.homedir(), "Library/Application Support/汽水音乐/Packages"),',
  '  ];',
  '  for (let r = 0; r < roots.length; r += 1) {',
  '    let names = [];',
  '    try { names = fs.readdirSync(roots[r]); } catch (error) { continue; }',
  '    names = names.filter(function (name) {',
  '      const parts = name.split(".");',
  '      return parts.length === 3 && parts.every(function (part) { return /^[0-9]+$/.test(part); });',
  '    });',
  '    names.sort(function (a, b) {',
  '      const left = a.split(".").map(Number);',
  '      const right = b.split(".").map(Number);',
  '      for (let i = 0; i < 3; i += 1) { if (left[i] !== right[i]) return right[i] - left[i]; }',
  '      return 0;',
  '    });',
  '    for (let i = 0; i < names.length; i += 1) {',
  '      const file = path.join(roots[r], names[i], "app.asar.unpacked", "bdms.node");',
  '      try { if (fs.existsSync(file)) return file; } catch (error) {}',
  '    }',
  '  }',
  '  return null;',
  '}',
  'const bdms = findBdms();',
  'if (!bdms) { process.stderr.write("bdms.node not found"); process.exit(2); }',
  'const sdk = require(bdms);',
  'let ready = false;',
  'function signRequest(request) {',
  '  if (!ready) {',
  '    sdk.init({ deviceId: String(request.deviceId) });',
  '    ready = true;',
  '  }',
  '  const out = {};',
  '  const names = Object.keys(request.headers || {});',
  '  const lines = [];',
  '  for (let i = 0; i < names.length; i += 1) { lines.push(names[i], request.headers[names[i]]); }',
  '  const flat = String(sdk.generateHttpSignatureHeaders(request.url, lines.join(CRLF)));',
  '  const pairs = flat.split(CRLF).filter(Boolean);',
  '  for (let i = 0; i + 1 < pairs.length; i += 2) {',
  '    const name = pairs[i].toLowerCase();',
  '    if (name === "x-helios" || name === "x-medusa") out[name] = pairs[i + 1];',
  '  }',
  '  return out;',
  '}',
  'const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });',
  'rl.on("line", function (line) {',
  '  if (!line) return;',
  '  const out = { id: 0 };',
  '  try {',
  '    const request = JSON.parse(line);',
  '    out.id = request.id;',
  '    if (request.warm) { signRequest({ deviceId: request.deviceId, headers: {}, url: "" }); out.ready = true; }',
  '    else {',
  '      const signature = signRequest(request);',
  '      if (!signature["x-helios"] || !signature["x-medusa"]) throw new Error("incomplete signature");',
  '      out["x-helios"] = signature["x-helios"];',
  '      out["x-medusa"] = signature["x-medusa"];',
  '    }',
  '  } catch (error) { out.error = String((error && error.message) || error); }',
  '  process.stdout.write(JSON.stringify(out) + CRLF);',
  '});',
  'process.stdin.on("end", function () { process.exit(0); });',
  'process.stdin.on("close", function () { process.exit(0); });',
].join("\n");

function randomDigits(count) {
  let text = "";
  for (let i = 0; i < count; i += 1) {
    text += String(i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10));
  }
  return text;
}

// 签名参数里的设备号会被服务端和签名绑定，首次使用时随机生成并持久化。
function deviceProfile() {
  let saved = null;
  try {
    saved = host.storage.get(DEVICE_KEY);
  } catch (error) {
    saved = null;
  }
  if (saved && typeof saved === "object") {
    const id = String(saved.id || "");
    const iid = String(saved.iid || "");
    if (/^[0-9]{10,20}$/.test(id)) {
      return { id, iid: /^[0-9]{10,20}$/.test(iid) ? iid : randomDigits(15) };
    }
  }
  const device = { id: randomDigits(16), iid: randomDigits(15) };
  try {
    host.storage.set(DEVICE_KEY, device);
  } catch (error) {
    // 存不下就每次换号，不影响功能
  }
  return device;
}

function signedPcParams(device) {
  return {
    aid: "386088",
    app_name: "luna_pc",
    region: "cn",
    geo_region: "cn",
    os_region: "cn",
    sim_region: "",
    device_id: device.id,
    cdid: "",
    iid: device.iid,
    version_name: "3.7.0",
    version_code: "30070000",
    channel: "official",
    build_mode: "master",
    network_carrier: "",
    ac: "wifi",
    tz_name: "Asia/Shanghai",
    resolution: "",
    device_platform: "mac",
    device_type: "Mac",
    os_version: "darwin",
    fp: device.id,
  };
}

function sortedQuery(params) {
  const keys = Object.keys(params).sort();
  const parts = [];
  for (const key of keys) {
    const value = params[key];
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(item)));
  }
  return parts.join("&");
}

function brief(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? text.slice(0, 120) + "…" : text;
}

function signerSetupError(message) {
  if (/allowed/i.test(message)) {
    return fail(
      "setup",
      "播放完整歌曲需要允许插件启动程序：设置 → 汽水音乐 → Allow Programs（允许启动程序），然后重试"
    );
  }
  if (/process permission|isn't one of the programs/i.test(message)) {
    return fail("setup", "插件没有启动签名程序的权限，请安装最新版本的汽水音乐插件");
  }
  return null;
}

function stopSigner() {
  const proc = signerProc;
  signerProc = null;
  if (proc) {
    try {
      proc.kill();
    } catch (error) {
      // 进程可能已经退出
    }
  }
}

async function launchSigner() {
  if (!onMac()) throw fail("setup", PLATFORM_MESSAGE);
  if (signerProc) return signerProc;
  if (!signerStarting) {
    signerStarting = (async function () {
      const candidates = [];
      if (signerApp) candidates.push(signerApp);
      for (const app of SIGNER_APPS) {
        if (candidates.indexOf(app) < 0) candidates.push(app);
      }
      let lastError = "";
      for (const app of candidates) {
        try {
          const proc = await host.spawn(SIGNER_BIN, ["ELECTRON_RUN_AS_NODE=1", app, "-e", SIGNER_SOURCE]);
          signerApp = app;
          signerProc = proc;
          return proc;
        } catch (error) {
          const message = brief(error && error.message) || "签名程序启动失败";
          const mapped = signerSetupError(message);
          if (mapped) throw mapped;
          lastError = message;
        }
      }
      throw fail(
        "unavailable",
        "汽水音乐签名不可用（完整播放需要本机安装官方汽水音乐客户端并允许插件启动程序）：" +
          (lastError || "未知错误")
      );
    })();
    const pending = signerStarting;
    pending.then(
      function () {
        if (signerStarting === pending) signerStarting = null;
      },
      function () {
        if (signerStarting === pending) signerStarting = null;
      }
    );
  }
  return signerStarting;
}

function readSignerLine(proc, timeoutMs) {
  return new Promise(function (resolve) {
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      resolve(null);
    }, timeoutMs);
    proc.readLine().then(
      function (line) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(line);
      },
      function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

async function exchangeSigner(request) {
  const proc = await launchSigner();
  const id = ++signerRequestId;
  try {
    proc.write(
      JSON.stringify({
        id,
        warm: request.warm === true,
        url: request.url || "",
        headers: request.headers || {},
        deviceId: request.deviceId,
      }) + "\n"
    );
  } catch (error) {
    stopSigner();
    throw fail("unavailable", "签名程序已退出，请重试");
  }
  for (;;) {
    const line = await readSignerLine(proc, 20000);
    if (!line) {
      stopSigner();
      throw fail("unavailable", "等待签名超时，请重试");
    }
    let message = null;
    try {
      message = JSON.parse(line);
    } catch (error) {
      message = null;
    }
    if (!message || Number(message.id) !== id) continue;
    if (request.warm) {
      if (message.error) throw fail("unavailable", "签名程序初始化失败：" + brief(message.error));
      return null;
    }
    if (message.error) throw fail("unavailable", "签名失败：" + brief(message.error));
    if (message["x-helios"] && message["x-medusa"]) {
      return { "x-helios": message["x-helios"], "x-medusa": message["x-medusa"] };
    }
    throw fail("unavailable", "签名结果不完整，请重试");
  }
}

// 整个 request-response 交换串行化，避免并发播放时两个调用抢同一行输出。
function signMessage(request) {
  const run = signerQueue.then(
    function () {
      return exchangeSigner(request);
    },
    function () {
      return exchangeSigner(request);
    }
  );
  signerQueue = run.then(
    function () {},
    function () {}
  );
  return run;
}

const signatureCache = new Map();
const SIGNATURE_TTL = 10 * 60 * 1000;
const SIGNATURE_CACHE_LIMIT = 24;
let signatureWarm = false;

function signatureKey(url, headers) {
  return String(host.crypto.md5(url + "\n" + JSON.stringify(headers)));
}

async function signatureFor(url, headers) {
  const key = signatureKey(url, headers);
  const cached = signatureCache.get(key);
  if (cached && Date.now() - cached.at < SIGNATURE_TTL) return cached.signature;
  if (!onMac()) throw fail("setup", PLATFORM_MESSAGE);
  const signature = await signMessage({ url, headers, deviceId: deviceProfile().id });
  signatureCache.set(key, { signature, at: Date.now() });
  while (signatureCache.size > SIGNATURE_CACHE_LIMIT) {
    const first = signatureCache.keys().next();
    if (first.done) break;
    signatureCache.delete(first.value);
  }
  return signature;
}

function clearSignatures() {
  signatureCache.clear();
}

function signedHeaders(jar, localUser) {
  const headers = { "User-Agent": SIGNED_PC_UA, Accept: "application/json" };
  if (jar && Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
  headers["Content-Type"] = "application/json; charset=utf-8";
  headers["Accept-Encoding"] = "identity";
  headers["X-Luna-Background-Type"] = "foreground";
  headers["X-Luna-Is-Background-Req"] = "0";
  headers["X-Luna-Is-Local-User"] = localUser ? "1" : "0";
  return headers;
}

async function signedSend(method, url, headers, signature, data) {
  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, 15000);
  try {
    const response = await fetch(url, {
      method,
      headers: Object.assign({}, headers, signature),
      body: data,
      redirect: "error",
      signal: controller.signal,
    });
    let text = "";
    try {
      text = await response.text();
    } catch (error) {
      text = "";
    }
    return { response, text };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("汽水音乐请求超时，请稍后重试");
    throw new Error("无法连接汽水音乐，请检查网络或系统代理后重试");
  } finally {
    clearTimeout(timer);
  }
}

async function signedRequest(path, body, query) {
  const params = Object.assign({}, signedPcParams(deviceProfile()), query || {});
  const url = PC + path + "?" + sortedQuery(params);
  const jar = currentSession().cookies;
  const headers = signedHeaders(jar, path === HISTORY_PATH);
  let data;
  if (body === undefined) {
    // GET 没有 body，也就不带 Content-Type；签名覆盖的是实际发送的头。
    delete headers["Content-Type"];
  } else {
    data = JSON.stringify(body);
    headers["X-SS-STUB"] = String(host.crypto.md5(data)).toUpperCase();
  }
  const method = data === undefined ? "GET" : "POST";
  let result = await signedSend(method, url, headers, await signatureFor(url, headers), data);
  if (result.response.ok && !result.text) {
    // 签名过期或风控要求新签名：清掉缓存再签一次。
    clearSignatures();
    result = await signedSend(method, url, headers, await signatureFor(url, headers), data);
  }
  const response = result.response;
  if (response.status === 401 || response.status === 403) {
    throw fail("signIn", "汽水音乐登录状态已失效，请重新扫码登录");
  }
  if (!response.ok) throw new Error("汽水音乐请求失败（HTTP " + response.status + "）");
  if (jar) acceptCookies(response, jar);
  if (!result.text) throw fail("unavailable", "汽水音乐返回了空响应，请稍后重试");
  return payloadFrom(result.text);
}

function signedPC(path, body) {
  return signedRequest(path, body);
}

function signedGET(path, query) {
  return signedRequest(path, undefined, query);
}

// 登录后（或首页打开时）在后台把签名进程热好，第一次播放就不用再等 4 秒冷启动。
function warmSignature() {
  if (!onMac()) return;
  if (signatureWarm || signerProc || signerStarting || !signedIn()) return;
  signatureWarm = true;
  signMessage({ warm: true, deviceId: deviceProfile().id }).catch(function () {
    signatureWarm = false;
  });
}

// ---------- 数据转换 ----------

function toArtist(raw) {
  if (!raw) return null;
  const id = raw.id === undefined || raw.id === null ? "" : String(raw.id);
  const name = raw.name || raw.simple_display_name || "";
  if (!id && !name) return null;
  return { id, name, imageUrl: coverURL(raw.url_avatar || raw.avatar_url, 240) };
}

function artistsOfTrack(track) {
  const source =
    track && Array.isArray(track.artists) && track.artists.length
      ? track.artists
      : track && track.album && Array.isArray(track.album.artists)
        ? track.album.artists
        : [];
  return source.map(toArtist).filter(Boolean);
}

function toAlbum(raw) {
  if (!raw) return { id: "", name: "" };
  return {
    id: raw.id === undefined || raw.id === null ? "" : String(raw.id),
    name: raw.name || "未知专辑",
    imageUrl: coverURL(raw.url_cover || raw.url_avatar, 320),
    artists: (Array.isArray(raw.artists) ? raw.artists : []).map(toArtist).filter(Boolean),
    released: dateText(raw.release_date),
  };
}

function toTrack(raw) {
  if (!raw || raw.id === undefined || raw.id === null) return null;
  const id = String(raw.id);
  return {
    id,
    name: raw.name || raw.title || "",
    artists: artistsOfTrack(raw),
    album: toAlbum(raw.album),
    duration: Number(raw.duration) || 0,
    // 分享/复制链接用源站歌曲页，不是音频地址。
    url: "https://www.douyin.com/qishui/song/" + id,
  };
}

function trackList(items) {
  return (Array.isArray(items) ? items : []).map(toTrack).filter(Boolean);
}

function profileID() {
  const active = currentSession();
  return active.profile && active.profile.id ? String(active.profile.id) : "";
}

function toPlaylist(raw, options) {
  if (!raw) return null;
  const opts = options || {};
  const owner = raw.owner || raw.creator || {};
  const ownerID = owner.id === undefined || owner.id === null ? "" : String(owner.id);
  const mineID = opts.profileID === undefined ? profileID() : opts.profileID;
  const type = Number(raw.type);
  const mine = !!mineID && ownerID === mineID;
  return {
    id: raw.id === undefined || raw.id === null ? "" : String(raw.id),
    name: raw.title || raw.name || "",
    imageUrl: coverURL(raw.url_cover, 400),
    description: raw.desc || raw.description || "",
    owner: owner.nickname || owner.name || "",
    trackCount: Number(raw.count_tracks || raw.track_count) || 0,
    mine: mine,
    // 自己的歌单里，只有普通歌单（type 2/3/11）允许改名、增删歌和排序。
    fixed: mine && ORDINARY_PLAYLIST_TYPES.indexOf(type) < 0,
    saved: opts.saved === true || (!mine && !!(raw.state && raw.state.is_collected)),
  };
}

// ---------- 首页 / 榜单 ----------

function discoverPlaylists(block) {
  const out = [];
  for (const inner of (block && block.inner_block) || []) {
    for (const resource of inner.resources || []) {
      const raw = resource && resource.entity && resource.entity.playlist;
      const item = toPlaylist(raw);
      if (item && item.id) out.push(item);
    }
  }
  return out;
}

function discoverCharts(data) {
  const block = ((data && data.blocks) || []).find(
    (item) => item && item.type === "discover_top_song_list"
  );
  const charts = [];
  for (const inner of (block && block.inner_block) || []) {
    const list = [];
    for (const resource of inner.resources || []) {
      const ranked = resource && resource.entity && resource.entity.ranked_track;
      if (ranked && ranked.track) list.push(ranked.track);
    }
    const tracks = trackList(list);
    if (tracks.length) {
      charts.push({ title: inner.title || "榜单", description: inner.desc || "", tracks });
    }
  }
  return charts;
}

async function discoverData(force) {
  if (!force && discoverCache && Date.now() - discoverCache.at < 180000) {
    return discoverCache.data;
  }
  const data = await luna("/luna/discover", { body: {} });
  discoverCache = { at: Date.now(), data };
  return data;
}

// ---------- 听歌模式 / 私人漫游 ----------
// 汽水的「听歌模式」是 45 个场景模式里的常用项，加上「探索更多新模式」里按账号
// 推荐的电台。两者都可以走 PC 网页接口（带登录 Cookie，不需要签名），所以非 macOS
// 也能拿到完整列表；真正播放时仍由 App 调用 stationNext 一页页取歌。

const RECOMMEND_STATION = {
  id: "recommendations",
  name: "私人漫游",
  description: "根据你的口味持续推荐歌曲",
  imageUrl: "",
};

const COMMON_MODE_DEFS = [
  { id: "preference:familiar", name: "熟悉模式", description: "熟悉的歌，慢慢听" },
  { id: "preference:fresh", name: "新鲜模式", description: "没听过的歌，换点新鲜的" },
  { id: "scene:9", name: "抖音漫游", description: "刷到停不下来的热歌" },
  { id: "scene:34", name: "摸鱼", description: "工作间隙，偷偷听点" },
  { id: "scene:33", name: "驾车", description: "路上有音乐，堵车也不烦" },
  { id: "scene:5", name: "快乐时光", description: "把快乐放大声" },
  { id: "scene:3", name: "Chill 放松", description: "放松一下，慢慢呼吸" },
  { id: "scene:6", name: "专注模式", description: "专心做事时的背景音" },
];

function modeRowsOf(data) {
  const rows = [];
  const seen = {};
  for (const block of (data && data.feed_mode_block) || []) {
    for (const entry of block.feed_mode || []) {
      const scene = entry && entry.entity && entry.entity.feed_scene_mode;
      if (!scene || scene.scene_mode_id === undefined) continue;
      const id = String(scene.scene_mode_id);
      if (seen[id]) continue;
      seen[id] = true;
      rows.push({
        id,
        name: entry.text || "场景音乐",
        description: entry.cutover_toast || "",
        imageUrl: coverURL(entry.url_info, 400),
      });
    }
  }
  return rows;
}

async function feedModeRows(force) {
  if (!force && feedModeCache && Date.now() - feedModeCache.at < STATION_CACHE_MS) {
    return feedModeCache.rows;
  }
  let rows = [];
  try {
    rows = modeRowsOf(await pc("/luna/pc/feed/mode", { body: {} }));
  } catch (error) {
    rows = [];
  }
  feedModeCache = { at: Date.now(), rows };
  return rows;
}

function radioStationsOf(data) {
  const rows = [];
  const seen = {};
  for (const block of (data && data.blocks) || []) {
    for (const inner of block.inner_block || []) {
      for (const resource of inner.resources || []) {
        if (!resource || resource.type !== "radio") continue;
        const style = resource.style || {};
        const id = String(resource.resource_id || inner.inner_block_id || "");
        if (!id || seen[id]) continue;
        seen[id] = true;
        rows.push({
          id: "radio:" + id,
          name: style.title || inner.title || "电台",
          description: style.desc || "根据你的喜好推荐歌曲",
          imageUrl: coverURL((style.cover_url_list || [])[0] || style.cover_url, 400),
        });
      }
    }
  }
  return rows;
}

async function discoveryRadioStations(force) {
  if (!force && discoverRadioCache && Date.now() - discoverRadioCache.at < STATION_CACHE_MS) {
    return discoverRadioCache.rows;
  }
  let rows = [];
  try {
    const data = await pc("/luna/pc/discover", {
      body: { first_request: true, pc_new_discover_request: true },
    });
    rows = radioStationsOf(data);
  } catch (error) {
    rows = [];
  }
  discoverRadioCache = { at: Date.now(), rows };
  return rows;
}

// 官方「听歌模式」页：私人漫游 + 8 个常用模式 + 探索更多新模式（按账号推荐的电台）。
// 常用模式官方只给了一个透明底的白色线性图标，MyGo 的浅色卡片上几乎看不见；
// 这里用发现页编辑精选的真实封面做底图（同一个接口本来就要取），没有封面时才回退图标。
export async function stations() {
  const [modes, radios, mixes] = await Promise.all([
    feedModeRows(),
    discoveryRadioStations(),
    discoverMixPlaylists(),
  ]);
  const byScene = {};
  for (const mode of modes) byScene[mode.id] = mode;
  const covers = [];
  for (const item of mixes) if (item.imageUrl) covers.push(item.imageUrl);
  let nextCover = 0;
  const cover = () => {
    if (!covers.length) return "";
    return covers[nextCover++ % covers.length];
  };
  const list = [{ ...RECOMMEND_STATION, imageUrl: cover() }];
  for (const def of COMMON_MODE_DEFS) {
    const scene = def.id.indexOf("scene:") === 0 ? byScene[def.id.slice(6)] : null;
    list.push({
      id: def.id,
      name: scene ? scene.name : def.name,
      description: def.description,
      imageUrl: cover() || (scene ? scene.imageUrl : ""),
    });
  }
  for (const radio of radios) {
    if (list.length >= 24) break;
    list.push(radio);
  }
  for (let i = 0; i < list.length; i++) {
    if (!list[i].imageUrl && covers.length) {
      list[i] = { ...list[i], imageUrl: covers[i % covers.length] };
    }
  }
  return list;
}

function feedPreferenceOf(id) {
  if (id === "recommendations") return null;
  if (id.indexOf("preference:") === 0) {
    const mode = id.slice("preference:".length);
    if (mode === "familiar" || mode === "fresh") return { preference_mode: mode };
    throw fail("unsupported", "不支持这个听歌模式");
  }
  if (id.indexOf("scene:") === 0) {
    const value = Number(id.slice("scene:".length));
    if (Number.isSafeInteger(value) && value >= 0) return { scene_mode_id: value };
  }
  throw fail("unsupported", "不支持这个听歌模式");
}

function stationState(id) {
  let state = stationStates[id];
  if (!state) {
    const keys = Object.keys(stationStates);
    if (keys.length >= 64) delete stationStates[keys[0]];
    state = { count: 0, played: [], seen: {}, cursor: "", done: false };
    stationStates[id] = state;
  }
  return state;
}

function rememberStationTracks(state, tracks) {
  const fresh = [];
  for (const track of tracks) {
    if (!track || state.seen[track.id]) continue;
    state.seen[track.id] = true;
    fresh.push(track);
    state.played.push({ id: track.id, duration: Number(track.duration) || 0 });
  }
  state.played = state.played.slice(-30);
  // 一批全是刚才听过的歌时清空去重表，避免电台卡住不再出歌。
  if (!fresh.length && tracks.length) {
    state.seen = {};
    for (const track of tracks) state.seen[track.id] = true;
    return tracks;
  }
  return fresh;
}

async function stationNextFeed(id) {
  const state = stationState(id);
  const count = state.count + 1;
  state.count = count;
  const body = {
    played_media: state.played.map((track) => ({
      type: "track",
      media_id: track.id,
      duration: Math.floor((Number(track.duration) || 0) / 1000),
      played_mills: -1,
    })),
    is_first_request: count === 1,
    is_did_first_request: false,
    feed_counts: { mix_session_count: count },
  };
  const preference = feedPreferenceOf(id);
  if (preference) body.feed_preference = preference;
  let data;
  try {
    data = await pc("/luna/pc/feed/song-tab", { body, timeoutMs: 20000 });
  } catch (error) {
    state.count -= 1;
    throw error;
  }
  const tracks = trackList(
    (data.items || []).map((item) => rawTrackOf(item && item.entity)).filter(Boolean)
  );
  return rememberStationTracks(state, tracks);
}

async function stationNextRadio(radioID) {
  const id = "radio:" + radioID;
  const state = stationState(id);
  if (state.done) return [];
  const body = { radio_id: radioID, count: 6 };
  if (state.cursor) body.cursor = state.cursor;
  const data = await pc("/luna/pc/feed/radio/tracks", { body, timeoutMs: 20000 });
  if (data.next_cursor !== undefined && data.next_cursor !== null && String(data.next_cursor) !== "") {
    state.cursor = String(data.next_cursor);
  }
  if (data.has_more === false) state.done = true;
  state.count += 1;
  const tracks = trackList(
    (data.items || []).map((item) => rawTrackOf(item && item.entity)).filter(Boolean)
  );
  return rememberStationTracks(state, tracks);
}

export async function stationNext({ id }) {
  requireSignedIn("登录汽水音乐后才能播放个人电台");
  const key = String(id === undefined || id === null ? "" : id).trim();
  if (!key) throw fail("unsupported", "没有这个电台");
  if (key.indexOf("radio:") === 0) {
    const radioID = key.slice("radio:".length);
    if (!/^\d{1,20}$/.test(radioID)) throw fail("unsupported", "没有这个电台");
    return stationNextRadio(radioID);
  }
  return stationNextFeed(key);
}

// 首页「推荐」的第一块：官方推荐流是电台，先把私人漫游入口放在最上面。
// 真正取歌由 stationNext 负责，这里只给一张卡片。
function personalRadioSection(imageUrl) {
  return {
    title: "私人漫游",
    subtitle: "根据你的口味持续推荐",
    stations: [{ ...RECOMMEND_STATION, imageUrl: imageUrl || "" }],
  };
}

// ---------- PC 发现页 ----------
// 旧的 /luna/discover 与首页共用同一份歌单，导致「发现」和「首页」第一屏一模一样。
// PC 发现页的编辑精选和猜你喜欢是另外两组数据，且带 Cookie 即个性化。

function pcDiscoverPlaylists(data) {
  const rows = [];
  const seen = {};
  for (const inner of (data && data.inner_block) || []) {
    for (const resource of inner.resources || []) {
      if (!resource || resource.type !== "playlist") continue;
      const raw = resource.entity && resource.entity.playlist;
      const item = toPlaylist(raw);
      if (!item || !item.id || seen[item.id]) continue;
      seen[item.id] = true;
      rows.push(item);
    }
  }
  return rows;
}

async function discoverMixPlaylists(force) {
  if (!force && discoverMixCache && Date.now() - discoverMixCache.at < STATION_CACHE_MS) {
    return discoverMixCache.rows;
  }
  let rows = [];
  try {
    rows = pcDiscoverPlaylists(await pc("/luna/pc/discover/mix", { body: {} }));
  } catch (error) {
    rows = [];
  }
  discoverMixCache = { at: Date.now(), rows };
  return rows;
}

async function songTabTracks(force) {
  if (!force && songTabCache && Date.now() - songTabCache.at < STATION_CACHE_MS) {
    return songTabCache.tracks;
  }
  let tracks = [];
  try {
    const data = await pc("/luna/pc/feed/song-tab", {
      body: { cursor: "", count: 20 },
      timeoutMs: 20000,
    });
    tracks = trackList(
      (data.items || []).map((item) => rawTrackOf(item && item.entity)).filter(Boolean)
    );
  } catch (error) {
    tracks = [];
  }
  songTabCache = { at: Date.now(), tracks };
  return tracks;
}

export async function home() {
  warmSignature();
  const data = await discoverData();
  const playlistBlock = (data.blocks || []).find(
    (item) => item && item.type === "discover_feed_playlist"
  );
  const playlists = playlistBlock ? discoverPlaylists(playlistBlock) : [];
  const sections = [];
  if (signedIn()) {
    const cover = playlists.length ? playlists[playlists.length - 1].imageUrl : "";
    sections.push(personalRadioSection(cover));
  }
  if (playlists.length) sections.push({ title: "推荐歌单", playlists: playlists.slice(0, 20) });
  // 榜单、最近播放都有独立侧栏入口，首页不再重复放一遍。
  return { title: "汽水音乐", subtitle: "发现好音乐", sections };
}

export async function browse({ page }) {
  const name = String(page || "");
  if (name === "discover") {
    const [playlists, tracks] = await Promise.all([discoverMixPlaylists(), songTabTracks()]);
    if (playlists.length || tracks.length) {
      const sections = [];
      if (playlists.length) sections.push({ title: "编辑精选", playlists });
      if (tracks.length) sections.push({ title: "猜你喜欢", tracks });
      return {
        title: "发现",
        subtitle: "汽水音乐 · 编辑精选与个性化推荐",
        sections,
      };
    }
    // PC 接口失败时退回旧的 APP 发现页，至少不要白屏。
    const data = await discoverData();
    const block = (data.blocks || []).find(
      (item) => item && item.type === "discover_feed_playlist"
    );
    const fallback = block ? discoverPlaylists(block) : [];
    return {
      title: "发现",
      subtitle: "汽水音乐 · 编辑精选歌单",
      sections: [{ title: "推荐歌单", playlists: fallback, empty: "暂时没有推荐歌单" }],
    };
  }
  if (name === "charts") {
    const charts = discoverCharts(await discoverData());
    return {
      title: "榜单",
      subtitle: "汽水音乐 · 实时榜单",
      sections: charts.map((chart) => ({
        title: chart.title,
        subtitle: chart.description || undefined,
        tracks: chart.tracks,
      })),
    };
  }
  if (name.startsWith("chart:")) {
    const wanted = name.slice("chart:".length);
    const chart = discoverCharts(await discoverData()).find((item) => item.title === wanted);
    if (!chart) throw fail("unsupported", "没有这个榜单");
    return {
      title: chart.title,
      subtitle: chart.description || undefined,
      sections: [{ title: "全部歌曲", tracks: chart.tracks }],
    };
  }
  if (name === "history") {
    if (!signedIn()) throw fail("signIn", "扫码登录汽水音乐后，这里会显示最近播放");
    const items = await recentTracks();
    return {
      title: "最近播放",
      subtitle: "汽水音乐 · 最近播放过的歌曲",
      sections: [{ title: "歌曲", tracks: items, empty: "还没有最近播放的歌曲" }],
    };
  }
  throw fail("unsupported", "没有这个页面");
}

// ---------- 搜索 ----------

// 汽水同一实体在不同接口里包法不一致：搜索是 entity.track，歌单里是
// entity.track_wrapper.track。这里统一取到裸曲目对象。
function rawTrackOf(entity) {
  if (!entity || typeof entity !== "object") return null;
  if (entity.track_wrapper && entity.track_wrapper.track) return entity.track_wrapper.track;
  if (entity.track) return entity.track;
  return null;
}

const SEARCH_KINDS = {
  tracks: { path: "/luna/search/track", entity: "track", out: "tracks", map: toTrack },
  albums: { path: "/luna/search/album", entity: "album", out: "albums", map: toAlbum },
  artists: { path: "/luna/search/artist", entity: "artist", out: "artists", map: toArtist },
  playlists: { path: "/luna/search/playlist", entity: "playlist", out: "playlists", map: (raw) => toPlaylist(raw) },
};

export async function search({ query, kind, offset }) {
  const text = String(query || "").trim();
  const type = SEARCH_KINDS[kind];
  if (!type) throw fail("unsupported", "汽水音乐支持搜索歌曲、专辑、歌手和歌单");
  const result = {};
  result[type.out] = [];
  result.more = false;
  if (!text) return result;
  const data = await luna(type.path, {
    params: { q: text, cursor: String(pageOffset(offset)), count: String(SEARCH_PAGE) },
  });
  const group = (data.result_groups || [])[0] || {};
  for (const item of group.data || []) {
    const entity = item && item.entity ? item.entity[type.entity] : null;
    if (!entity) continue;
    const mapped = type.map(entity);
    if (mapped) result[type.out].push(mapped);
  }
  result.more = !!group.has_more;
  return result;
}

export async function suggest({ query }) {
  const text = String(query || "").trim();
  if (!text) return [];
  const data = await luna("/luna/sug", { params: { q: text } });
  const seen = new Set();
  const out = [];
  for (const item of data.sugs || []) {
    const value = String((item && (item.suggestion || item.query || item.content)) || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= 10) break;
  }
  return out;
}

// ---------- 账号 ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasLoginCookie(jar) {
  return Object.keys(jar || {}).some((name) => /^(sessionid|sessionid_ss|sid_tt|sid_guard)$/i.test(name));
}

async function requestQRCode(jar) {
  const params = {};
  for (const key of Object.keys(PASSPORT_PARAMS)) params[key] = PASSPORT_PARAMS[key];
  params.next = "https://api.qishui.com";
  params.need_logo = "false";
  params.need_short_url = "false";
  params.is_new_login = "1";
  const url = PC + "/passport/web/get_qrcode/?" + queryString(params);
  return payloadFrom(await fetchText(url, { ua: WEB_UA, jar }));
}

async function checkQRCode(jar, token) {
  const url = PC + "/passport/web/check_qrconnect/?" + queryString(PASSPORT_PARAMS);
  const form = queryString({
    need_logo: "false",
    need_short_url: "false",
    is_frontier: "1",
    token,
    is_new_login: "1",
    next: "https://api.qishui.com",
  });
  return payloadFrom(await fetchText(url, { ua: WEB_UA, method: "POST", form, jar }));
}

async function fetchProfile(jar) {
  const data = await pc("/luna/pc/me", { jar });
  const info = data.my_info;
  if (!info || !info.id) return null;
  return {
    id: String(info.id),
    name: info.nickname || info.name || "汽水音乐用户",
    imageUrl: coverURL(info.larger_avatar_url || info.medium_avatar_url || info.avatar_url, 200),
  };
}

export async function signIn() {
  const startedEpoch = ++epoch;
  const jar = {};
  host.signInPrompt({ text: "正在生成汽水音乐登录二维码…" });
  let qr;
  try {
    qr = await requestQRCode(jar);
  } catch (error) {
    if (error.code === "signIn") throw error;
    throw new Error("无法生成登录二维码，请检查网络后重试");
  }
  const data = qr && qr.data ? qr.data : {};
  const token = data.token;
  const qrURL = data.qrcode_index_url;
  if (!token || !qrURL) throw new Error("汽水音乐没有返回登录二维码，请稍后重试");
  host.signInPrompt({ qr: qrURL, text: "请用抖音 App 扫码，并在手机上确认登录汽水音乐" });
  const deadline = Date.now() + SIGN_IN_DEADLINE;
  let scanned = false;
  while (Date.now() < deadline) {
    checkEpoch(startedEpoch);
    await sleep(1500);
    checkEpoch(startedEpoch);
    let result;
    try {
      result = await checkQRCode(jar, token);
    } catch (error) {
      if (error.code === "signIn") throw error;
      continue; // 单次轮询失败不结束登录，交给 deadline
    }
    const payload = (result && result.data) || {};
    const status = String(payload.status || "").toLowerCase();
    if (hasLoginCookie(jar)) {
      return await finishSignIn(jar, startedEpoch);
    }
    if (status === "scanned" || status === "scan" || status === "2") {
      if (!scanned) {
        scanned = true;
        host.signInPrompt({ qr: qrURL, text: "已扫码，请在手机上确认登录" });
      }
      continue;
    }
    if (status === "confirmed" || status === "confirm" || status === "success" || status === "1") {
      return await finishSignIn(jar, startedEpoch);
    }
    if (
      status === "expired" ||
      status === "expire" ||
      status === "refused" ||
      status === "refuse" ||
      status === "3" ||
      status === "4"
    ) {
      throw new Error("二维码已过期，请重新点击登录");
    }
  }
  throw new Error("登录已超时或取消，请重新点击登录");
}

async function finishSignIn(jar, startedEpoch) {
  let profile = null;
  try {
    profile = await fetchProfile(jar);
  } catch (error) {
    if (error.code === "signIn") throw new Error("汽水音乐没有返回有效会话，请重新扫码登录");
    throw error;
  }
  if (!profile) throw new Error("无法读取已登录的汽水音乐账号，请重新扫码登录");
  checkEpoch(startedEpoch);
  session = { cookies: jar, profile, signedIn: true };
  discoverCache = null;
  likedCache = null;
  persistSession();
  host.signInPrompt({ text: "登录成功" });
  return profile;
}

export async function signOut() {
  // 只忘掉插件自己的会话，不影响手机或网页上的汽水音乐登录。
  stopSigner();
  signatureWarm = false;
  clearSignatures();
  clearSession();
}

export async function account() {
  if (!signedIn()) return null;
  const startedEpoch = epoch;
  let profile;
  try {
    profile = await fetchProfile(currentSession().cookies);
  } catch (error) {
    if (error.code === "signIn") {
      clearSession();
      return null;
    }
    throw error;
  }
  checkEpoch(startedEpoch);
  if (!profile) {
    clearSession();
    return null;
  }
  const active = currentSession();
  active.profile = profile;
  persistSession();
  // 后台把签名进程热好（冷启动约 4 秒），第一次点播放就不用等它启动。
  warmSignature();
  return profile;
}



// ---------- 专辑 / 歌手 / 歌单 ----------

export async function album({ id }) {
  const albumID = asID(id);
  const results = await Promise.all([pc("/luna/pc/albums/" + albumID), savedAlbumIDsSafe()]);
  const data = results[0];
  const saved = results[1];
  const info = data.album_info;
  if (!info) throw new Error("找不到这张专辑");
  const item = toAlbum(info);
  item.saved = saved.has(albumID);
  return { album: item, tracks: trackList(data.tracks) };
}

export async function artist({ id }) {
  const artistID = asID(id);
  const results = await Promise.all([pc("/luna/pc/artists/" + artistID), followedArtistIDsSafe()]);
  const data = results[0];
  const following = results[1];
  const info = data.artist_info;
  if (!info) throw new Error("找不到这个歌手");
  const tracks = [];
  const seen = new Set();
  const push = (list) => {
    for (const track of trackList(list)) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      tracks.push(track);
    }
  };
  push(data.hot_tracks);
  const first = await pc("/luna/pc/artists/" + artistID + "/tracks", {
    params: { cursor: "0", count: String(PAGE_SIZE) },
  });
  push(first.tracks);
  const next = Number(first.next_cursor);
  if (first.has_more && Number.isSafeInteger(next) && next > 0 && tracks.length < 100) {
    const second = await pc("/luna/pc/artists/" + artistID + "/tracks", {
      params: { cursor: String(next), count: String(PAGE_SIZE) },
    });
    push(second.tracks);
  }
  const albums = (Array.isArray(data.hot_albums) ? data.hot_albums : [])
    .map((raw) => toAlbum(raw))
    .filter((item) => item && item.id);
  const artist = toArtist(info);
  artist.following = following.has(artistID);
  return { artist: artist, tracks: tracks.slice(0, 100), albums: albums.slice(0, 30) };
}

async function myPlaylists() {
  const data = await luna("/luna/me/playlist");
  return Array.isArray(data.playlists) ? data.playlists : [];
}

export async function playlists() {
  if (!signedIn()) throw fail("signIn", "扫码登录汽水音乐后，这里会显示你的歌单");
  const me = profileID();
  const own = await myPlaylists();
  // 收藏的歌单不在 /luna/me/playlist 里，要单独从签名接口取；签名不可用时
  // （没装官方客户端）只显示自己的歌单，不影响页面打开。
  let savedRows = [];
  try {
    savedRows = await savedPlaylistRows();
  } catch (error) {
    if (error && error.code === "signIn") throw error;
  }
  const out = [];
  const seen = new Set();
  const push = (raw, options) => {
    const item = toPlaylist(raw, options);
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  };
  for (const raw of own) push(raw, { profileID: me });
  for (const raw of savedRows) push(raw, { profileID: me, saved: true });
  return out;
}

async function likedPlaylist() {
  const list = await myPlaylists();
  const found =
    list.find((item) => item && Number(item.type) === 1) ||
    list.find((item) => item && /喜欢/.test(String(item.title || "")));
  if (!found || !found.id) {
    throw fail("unavailable", "没有找到“我喜欢的音乐”歌单，请先在汽水音乐里喜欢一首歌");
  }
  return found;
}

// 歌单详情：一页 50 首，按 next_cursor 取到上限；汽水对单页条数有上限，
// 所以不能用一次大 count 取完。
async function loadPlaylist(id) {
  const tracks = [];
  let raw = null;
  let cursor = 0;
  for (let page = 0; page < 10; page++) {
    const data = await luna("/luna/playlist/detail", {
      body: { playlist_id: id, cursor: String(cursor), count: String(PAGE_SIZE) },
    });
    if (data.playlist && !raw) raw = data.playlist;
    for (const item of data.media_resources || []) {
      const track = toTrack(rawTrackOf(item && item.entity ? item.entity : item));
      if (track) tracks.push(track);
    }
    if (tracks.length >= PLAYLIST_LIMIT) break;
    if (!data.has_more) break;
    const next = Number(data.next_cursor);
    if (!Number.isSafeInteger(next) || next <= cursor) break;
    cursor = next;
  }
  return { raw, tracks: tracks.slice(0, PLAYLIST_LIMIT) };
}

export async function playlist({ id }) {
  const playlistID = asID(id);
  const loaded = await loadPlaylist(playlistID);
  if (!loaded.raw) throw new Error("找不到这个歌单");
  const item = toPlaylist(loaded.raw);
  if (!item.id) item.id = playlistID;
  item.tracks = loaded.tracks;
  if (item.tracks.length > item.trackCount) item.trackCount = item.tracks.length;
  // 别人的歌单在详情页上有收藏按钮，用收藏列表判断当前状态；取不到就按未收藏显示。
  if (!item.mine) {
    const rows = await decorationRows("playlist", savedPlaylistRows);
    if (rows) item.saved = rows.some((raw) => String(raw.id) === playlistID);
  }
  return item;
}

// ---------- 我喜欢的音乐 ----------

export async function liked({ offset }) {
  if (!signedIn()) throw fail("signIn", "扫码登录汽水音乐后，可以同步“我喜欢的音乐”");
  const raw = await likedPlaylist();
  const start = pageOffset(offset);
  const data = await luna("/luna/playlist/detail", {
    body: { playlist_id: String(raw.id), cursor: String(start), count: String(PAGE_SIZE) },
  });
  const tracks = [];
  for (const item of data.media_resources || []) {
    const track = toTrack(rawTrackOf(item && item.entity ? item.entity : item));
    if (track) tracks.push(track);
  }
  const next = Number(data.next_cursor);
  const more = !!data.has_more || (Number.isSafeInteger(next) && next > start + tracks.length);
  return { tracks, more: more && tracks.length > 0 };
}

const LIKED_CACHE_MS = 60 * 1000;
const LIKED_SCAN_LIMIT = 1000;

async function collectLikedIDs() {
  if (likedCache && Date.now() - likedCache.at < LIKED_CACHE_MS) return likedCache.ids;
  const ids = new Set();
  try {
    const raw = await likedPlaylist();
    let cursor = 0;
    for (let page = 0; page < 20 && ids.size < LIKED_SCAN_LIMIT; page++) {
      const data = await luna("/luna/playlist/detail", {
        body: { playlist_id: String(raw.id), cursor: String(cursor), count: String(PAGE_SIZE) },
      });
      for (const item of data.media_resources || []) {
        const track = rawTrackOf(item && item.entity ? item.entity : item);
        if (track && track.id !== undefined && track.id !== null) ids.add(String(track.id));
      }
      if (!data.has_more) break;
      const next = Number(data.next_cursor);
      if (!Number.isSafeInteger(next) || next <= cursor) break;
      cursor = next;
    }
  } catch (error) {
    // isLiked 是列表渲染时的装饰信息：失败时保持“未喜欢”，不打断播放界面。
    return ids;
  }
  likedCache = { at: Date.now(), ids };
  return ids;
}

export async function isLiked({ ids }) {
  const wanted = (Array.isArray(ids) ? ids : []).map((id) => String(id));
  const result = {};
  for (const id of wanted) result[id] = false;
  if (!wanted.length || !signedIn()) return result;
  const liked = await collectLikedIDs();
  for (const id of wanted) result[id] = liked.has(id);
  return result;
}

// ---------- 红心（收藏 / 取消收藏） ----------
// 官方收藏接口对 PC 请求同样校验签名，这里直接复用 signedPC。只实现「喜欢 / 取消
// 喜欢」这一种写操作；评论、歌单编辑等仍不实现。

const COLLECTION_PATH = "/luna/pc/me/collection/media";

function trackIDOf(value) {
  const text = value === undefined || value === null ? "" : String(value);
  if (!/^[0-9]{1,32}$/.test(text)) throw fail("unavailable", "歌曲 ID 无效，无法收藏");
  return text;
}

export async function like({ id, on }) {
  const trackID = trackIDOf(id);
  if (!signedIn()) throw fail("signIn", "登录汽水音乐后才能收藏歌曲");
  const media = [{ id: trackID, type: "track" }];
  const body = on ? { scene: "", media: media } : { media: media };
  await signedPC(on ? COLLECTION_PATH : COLLECTION_PATH + "/delete", body);
  likedCache = null;
}

export async function played({ id }) {
  if (!signedIn()) return;
  const trackID = trackIDOf(id);
  try {
    // 让播放同步进汽水自己的「最近播放」；失败不影响 App 播放。
    await signedPC(HISTORY_PATH, { media: [{ type: "track", id: trackID }] });
  } catch (error) {
    // played 只是尽力而为的通知
  }
}

// ---------- 收藏歌单 / 收藏专辑 / 关注艺人 ----------
// 这些状态只能从签名接口读：收藏的歌单和专辑在 /luna/pc/me/collection/mixed
// （item_types 重复传同名参数，重复的 key 不能拼进字符串），关注的艺人在
// /luna/pc/me/collection/artist。服务端有 1–3 秒的最终一致性，所以写入后立刻
// 再读可能还是旧结果；这里只做一分钟缓存，不做乐观更新，刷新时以服务端为准。

function rememberCollection(kind, value) {
  collectionCache[kind] = { at: Date.now(), value: value };
  return value;
}

function cachedCollection(kind) {
  const hit = collectionCache[kind];
  if (hit && Date.now() - hit.at < COLLECTION_CACHE_MS) return hit.value;
  return null;
}

function forgetCollection(kind) {
  delete collectionCache[kind];
}

async function collectMixed(kind) {
  const rows = [];
  let cursor = "";
  for (let page = 0; page < 10 && rows.length < COLLECTION_LIMIT; page++) {
    const data = await signedGET("/luna/pc/me/collection/mixed", {
      cursor: cursor,
      count: String(PAGE_SIZE),
      item_types: [kind],
    });
    for (const item of data.mixed_collections || []) {
      if (!item || item.item_type !== kind) continue;
      const raw = item[kind];
      if (raw && raw.id !== undefined && raw.id !== null) rows.push(raw);
    }
    if (!data.has_more) break;
    const next =
      data.next_cursor === undefined || data.next_cursor === null ? "" : String(data.next_cursor);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return rows.slice(0, COLLECTION_LIMIT);
}

async function savedPlaylistRows() {
  const hit = cachedCollection("playlist");
  if (hit) return hit;
  return rememberCollection("playlist", await collectMixed("playlist"));
}

async function savedAlbumRows() {
  const hit = cachedCollection("album");
  if (hit) return hit;
  return rememberCollection("album", await collectMixed("album"));
}

async function followedArtistRows() {
  const hit = cachedCollection("artist");
  if (hit) return hit;
  const data = await signedGET("/luna/pc/me/collection/artist", {
    cursor: "",
    count: String(PAGE_SIZE),
  });
  return rememberCollection("artist", Array.isArray(data.artists) ? data.artists : []);
}

// 专辑页、歌手页、别人的歌单页上的「已收藏 / 已关注」只是装饰：签名进程还没热好
// （冷启动要几秒）时先按未收藏显示，后台把列表取回来放进缓存，不为一个图标拖慢整页。
async function decorationRows(kind, fetcher) {
  if (!signedIn()) return null;
  const hit = cachedCollection(kind);
  if (hit) return hit;
  if (!signerProc) {
    fetcher().catch(function () {});
    return null;
  }
  try {
    return await fetcher();
  } catch (error) {
    return null;
  }
}

async function savedAlbumIDsSafe() {
  const rows = await decorationRows("album", savedAlbumRows);
  return new Set((rows || []).map((raw) => String(raw.id)));
}

async function followedArtistIDsSafe() {
  const rows = await decorationRows("artist", followedArtistRows);
  return new Set((rows || []).map((raw) => String(raw.id)));
}

// ---------- 歌单编辑 / 收藏（写操作） ----------

function requireSignedIn(message) {
  if (!signedIn()) throw fail("signIn", message);
}

function playlistName(value) {
  const title = String(value === undefined || value === null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
  if (!title) throw fail("unsupported", "歌单名称不能为空");
  if (title.length > 60) throw fail("unsupported", "歌单名称最长 60 个字符");
  return title;
}

function trackMediaOf(trackIds) {
  const source = Array.isArray(trackIds)
    ? trackIds
    : trackIds === undefined || trackIds === null
      ? []
      : [trackIds];
  const media = [];
  for (const value of source) {
    const id = String(value === undefined || value === null ? "" : value);
    if (!/^[0-9]{1,32}$/.test(id)) throw fail("unsupported", "歌曲 ID 不正确，无法修改歌单");
    media.push({ id: id, type: "track" });
  }
  if (!media.length) throw fail("unsupported", "没有选择要修改的歌曲");
  return media;
}

// 只允许改自己的歌单；普通歌单（type 2/3/11）可编辑，type 1（我喜欢的音乐）只允许
// 加/删歌，其余（抖音收藏等）完全固定。
async function ownPlaylistRaw(playlistID, allowLiked) {
  const me = profileID();
  if (!me) throw fail("signIn", "扫码登录汽水音乐后才能修改歌单");
  const list = await myPlaylists();
  for (const raw of list) {
    if (!raw || String(raw.id) !== playlistID) continue;
    const owner = raw.owner || raw.creator || {};
    if (String(owner.id) !== me) break;
    const type = Number(raw.type);
    const ordinary = ORDINARY_PLAYLIST_TYPES.indexOf(type) >= 0;
    if (!ordinary && !(allowLiked && type === 1)) {
      throw fail("unsupported", "这个歌单由汽水音乐固定管理，不能在 App 里修改");
    }
    return raw;
  }
  throw fail("unsupported", "只能修改自己创建的歌单");
}

function trackIndex(value) {
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 0) throw fail("unsupported", "歌曲位置不正确");
  return index;
}

// 排序接口要求提交完整顺序，所以先读整张歌单；遇到 MV 等非歌曲内容就放弃，
// 避免把不认识的条目从歌单里挤掉。
async function playlistRawOrder(playlistID) {
  const ids = [];
  let cursor = 0;
  for (let page = 0; page < 10; page++) {
    const data = await luna("/luna/playlist/detail", {
      body: { playlist_id: playlistID, cursor: String(cursor), count: String(PAGE_SIZE) },
    });
    for (const item of data.media_resources || []) {
      const entity = item && item.entity ? item.entity : item;
      const track = entity && entity.track_wrapper ? entity.track_wrapper.track : entity && entity.track;
      if (!track || track.id === undefined || track.id === null) {
        throw fail("unsupported", "这个歌单里有非歌曲内容，暂时不能在 App 里排序");
      }
      ids.push(String(track.id));
    }
    if (!data.has_more) break;
    const next = Number(data.next_cursor);
    if (!Number.isSafeInteger(next) || next <= cursor) break;
    cursor = next;
  }
  if (ids.length >= PLAYLIST_LIMIT) throw fail("unsupported", "歌单太长，暂时不能在 App 里排序");
  return ids;
}

export async function createPlaylist({ name }) {
  requireSignedIn("扫码登录汽水音乐后才能新建歌单");
  const data = await signedPC(OWN_PLAYLIST_PATH, {
    name: playlistName(name),
    is_private: false,
    media: [],
  });
  const raw = data && data.playlist;
  if (!raw || raw.id === undefined || raw.id === null) throw new Error("汽水音乐没有返回新建的歌单");
  const item = toPlaylist(raw, { profileID: profileID() });
  item.mine = true;
  item.fixed = false;
  item.saved = false;
  return item;
}

export async function renamePlaylist({ id, name }) {
  const playlistID = asID(id);
  requireSignedIn("扫码登录汽水音乐后才能重命名歌单");
  const title = playlistName(name);
  await ownPlaylistRaw(playlistID, false);
  await signedPC(OWN_PLAYLIST_PATH + "/update", { playlist_id: playlistID, name: title });
}

export async function deletePlaylist({ id }) {
  const playlistID = asID(id);
  requireSignedIn("扫码登录汽水音乐后才能删除歌单");
  await ownPlaylistRaw(playlistID, false);
  await signedPC(OWN_PLAYLIST_PATH + "/delete", { playlist_ids: [playlistID] });
}

async function changePlaylist(id, trackIds, on) {
  const playlistID = asID(id);
  requireSignedIn("扫码登录汽水音乐后才能修改歌单");
  const media = trackMediaOf(trackIds);
  const raw = await ownPlaylistRaw(playlistID, true);
  if (Number(raw.type) === 1) {
    // 「我喜欢的音乐」也是收藏媒体的一种，加/删都走 collection/media。
    await signedPC(COLLECTION_ROOT + "/media" + (on ? "" : "/delete"), on ? { scene: "", media: media } : { media: media });
    likedCache = null;
    return;
  }
  await signedPC(OWN_PLAYLIST_PATH + "/media/" + (on ? "append" : "delete"), {
    playlist_id: playlistID,
    media: media,
  });
}

export async function addToPlaylist({ id, trackIds }) {
  await changePlaylist(id, trackIds, true);
}

export async function removeFromPlaylist({ id, trackIds }) {
  await changePlaylist(id, trackIds, false);
}

export async function movePlaylistTrack({ id, from, to }) {
  const playlistID = asID(id);
  requireSignedIn("扫码登录汽水音乐后才能调整歌单顺序");
  const start = trackIndex(from);
  const target = trackIndex(to);
  await ownPlaylistRaw(playlistID, false);
  if (start === target) return;
  const ids = await playlistRawOrder(playlistID);
  if (start >= ids.length || target >= ids.length) return;
  const moved = ids.splice(start, 1)[0];
  ids.splice(target, 0, moved);
  await signedPC(SORT_PATH, {
    playlist_id: playlistID,
    media: ids.map(function (trackID) {
      return { id: trackID, type: "track" };
    }),
  });
}

export async function savePlaylist({ id, on }) {
  const playlistID = asID(id);
  requireSignedIn("扫码登录汽水音乐后才能收藏歌单");
  await signedPC(COLLECTION_ROOT + "/playlist" + (on ? "" : "/delete"), {
    playlist_ids: [playlistID],
  });
  forgetCollection("playlist");
}

export async function saveAlbum({ id, on }) {
  const albumID = asID(id);
  requireSignedIn("扫码登录汽水音乐后才能收藏专辑");
  await signedPC(COLLECTION_ROOT + "/album" + (on ? "" : "/delete"), {
    album_ids: [albumID],
  });
  forgetCollection("album");
}

export async function followArtist({ id, on }) {
  const artistID = asID(id);
  requireSignedIn("扫码登录汽水音乐后才能关注歌手");
  await signedPC(COLLECTION_ROOT + "/artist" + (on ? "" : "/delete"), {
    artist_ids: [artistID],
  });
  forgetCollection("artist");
}

export async function savedAlbums({ offset }) {
  requireSignedIn("扫码登录汽水音乐后，这里会显示你收藏的专辑");
  const start = pageOffset(offset);
  const rows = await savedAlbumRows();
  const albums = rows
    .map(function (raw) {
      const item = toAlbum(raw);
      if (item && item.id) item.saved = true;
      return item;
    })
    .filter(function (item) {
      return item && item.id;
    });
  return {
    albums: albums.slice(start, start + SAVED_ALBUMS_PAGE),
    more: start + SAVED_ALBUMS_PAGE < albums.length,
  };
}

// ---------- 最近播放 ----------

async function recentTracks(count) {
  const data = await luna("/luna/me/recently-played-media", {
    params: { cursor: "0", count: String(count || 50) },
  });
  const seen = new Set();
  const out = [];
  for (const item of data.media || []) {
    const track = toTrack(rawTrackOf(item && item.entity ? item.entity : item));
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

export async function recent() {
  if (!signedIn()) return [];
  try {
    return await recentTracks(100);
  } catch (error) {
    if (error.code === "signIn") return [];
    throw error;
  }
}

// ---------- 歌词 ----------

function pad2(value) {
  return value < 10 ? "0" + value : String(value);
}

function lrcTimestamp(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 100));
  const minutes = Math.floor(total / 6000);
  const rest = total - minutes * 6000;
  return "[" + pad2(minutes) + ":" + pad2(Math.floor(rest / 100)) + "." + pad2(rest % 100) + "]";
}

// 汽水歌词是 KRC：每行 [起始毫秒,持续毫秒]<字偏移,字时长,0>字…
// 逐字时间可以直接给 app 的 LyricWord；同时拼一份 LRC 作为兜底。
const KRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const KRC_WORD = /<(\d+),(\d+),\d+>([^<]*)/g;

function parseKRC(content) {
  const lines = [];
  KRC_WORD.lastIndex = 0;
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const match = KRC_LINE.exec(rawLine.trim());
    if (!match) continue;
    const baseMs = Number(match[1]);
    const durationMs = Number(match[2]);
    const words = [];
    let text = "";
    let word;
    KRC_WORD.lastIndex = 0;
    while ((word = KRC_WORD.exec(match[3]))) {
      const chunk = word[3];
      if (!chunk) continue;
      const offset = Number(word[1]);
      const duration = Number(word[2]);
      text += chunk;
      words.push({
        start: (baseMs + offset) / 1000,
        end: (baseMs + offset + Math.max(duration, 1)) / 1000,
        text: chunk,
      });
    }
    if (!text) continue;
    lines.push({
      start: baseMs / 1000,
      end: (baseMs + Math.max(durationMs, 1)) / 1000,
      text,
      words,
    });
  }
  return lines;
}

function parseLRC(content) {
  const lines = [];
  const pattern = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/;
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const match = pattern.exec(rawLine.trim());
    if (!match) continue;
    const text = match[4].trim();
    if (!text) continue;
    const centis = match[3] ? Number(match[3].length === 2 ? match[3] + "0" : match[3]) : 0;
    lines.push({
      start: Number(match[1]) * 60 + Number(match[2]) + centis / 1000,
      text,
    });
  }
  return lines;
}

async function seoTrack(id) {
  return luna("/luna/h5/seo_track", {
    params: { track_id: id, device_platform: "web" },
    ua: WEB_UA,
  });
}

// app 的 LyricLine/LyricWord 时间单位是毫秒整数（Go int64），传秒的小数会
// 让整个歌词响应反序列化失败、歌词面板显示“暂无歌词”，所以这里统一换算。
function lyricLinesMs(lines) {
  return lines.map((line) => {
    const start = Math.round(Number(line.start) * 1000);
    const end = Math.round(Number(line.end || line.start) * 1000);
    const out = { start, end, text: line.text };
    if (line.translation) out.translation = line.translation;
    if (line.words && line.words.length) {
      out.words = line.words.map((word) => ({
        start: Math.round(Number(word.start) * 1000),
        end: Math.round(Number(word.end) * 1000),
        text: word.text,
      }));
    }
    return out;
  });
}

export async function lyrics({ id }) {
  const trackID = asID(id);
  const data = await seoTrack(trackID);
  const lyric = data.lyric || {};
  const content = lyric.content ? String(lyric.content) : "";
  if (!content) return { lrc: "", lines: [] };
  if (String(lyric.type || "").toLowerCase() === "krc" || content.indexOf("<") !== -1) {
    const lines = parseKRC(content);
    if (lines.length) {
      return { lrc: lines.map((line) => lrcTimestamp(line.start) + line.text).join("\n"), lines: lyricLinesMs(lines) };
    }
  }
  const lines = parseLRC(content);
  if (lines.length) {
    return { lrc: lines.map((line) => lrcTimestamp(line.start) + line.text).join("\n"), lines: lyricLinesMs(lines) };
  }
  return { lrc: content };
}

// ---------- 评论 ----------
// 读评论走 PC 的 /luna/pc/comments，匿名即可读；登录后优先用签名请求，签名程序
// 不可用时退回匿名请求，评论照常能看。当前服务端不返回 user_digged（“我点过赞”），
// 所以 liked 只在本地记住本次点过的状态，评论点赞数仍以 count_digged 为准。
// 点赞评论、发表评论是写操作，必须登录 + 官方签名。

const COMMENTS_PAGE = 20;
const COMMENTS_MAX_PAGES = 20;
const COMMENTS_CACHE_TTL = 5 * 60 * 1000;
const COMMENTS_CACHE_LIMIT = 8;
const commentsCache = new Map();

function httpsURL(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return /^https:\/\/[^\s]+$/i.test(text) ? text : "";
}

function commentAvatar(raw) {
  if (!raw) return "";
  if (typeof raw === "string") return httpsURL(raw);
  const urls = Array.isArray(raw.urls) ? raw.urls : [];
  const uri = raw.uri ? String(raw.uri) : "";
  const prefix = raw.template_prefix ? String(raw.template_prefix) : "";
  for (const item of urls) {
    const base = httpsURL(item);
    if (!base) continue;
    if (uri && prefix && !raw.need_complete_url) {
      return base + uri + "~" + prefix + "-crop-center:100:100.jpg";
    }
    return base;
  }
  return httpsURL(raw.url) || httpsURL(raw.uri_url);
}

function commentOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = raw.id === undefined || raw.id === null ? "" : String(raw.id);
  const text = raw.content === undefined || raw.content === null ? "" : String(raw.content);
  if (!id || !text) return null;
  const user = raw.user || {};
  const brief = raw.user_artist_info && raw.user_artist_info.artist_brief;
  const name =
    (brief && typeof brief.name === "string" ? brief.name.trim() : "") ||
    (typeof user.nickname === "string" ? user.nickname.trim() : "") ||
    (typeof user.public_name === "string" ? user.public_name.trim() : "") ||
    "汽水音乐用户";
  const avatar =
    commentAvatar(brief && (brief.url_avatar || brief.thumb_avatar_url || brief.medium_avatar_url)) ||
    commentAvatar(user.thumb_avatar_url || user.medium_avatar_url || user.url_avatar);
  const comment = { id: id, author: name, text: text };
  if (avatar) comment.avatarUrl = avatar;
  const seconds = Number(raw.time_created);
  if (Number.isFinite(seconds) && seconds > 0) comment.time = Math.round(seconds * 1000);
  const likes = Number(raw.count_digged);
  if (Number.isFinite(likes) && likes >= 0) comment.likes = Math.floor(likes);
  if (typeof raw.user_digged === "boolean") comment.liked = raw.user_digged;
  return comment;
}

async function commentPage(id, cursor) {
  const params = {
    group_id: id,
    group_type: 0,
    cursor: cursor,
    count: COMMENTS_PAGE,
    image_strategy: 2,
  };
  if (signedIn()) {
    try {
      return await signedGET("/luna/pc/comments", params);
    } catch (error) {
      if (error && error.code === "signIn") throw error;
      // 签名程序不可用时退回匿名接口，评论照样能看。
    }
  }
  return pc("/luna/pc/comments", { params: params });
}

export async function comments({ trackId, offset }) {
  const id = asID(trackId);
  const start = pageOffset(offset);
  let state = start === 0 ? null : commentsCache.get(id);
  if (state && Date.now() - state.at > COMMENTS_CACHE_TTL) state = null;
  if (!state) {
    state = { at: Date.now(), comments: [], ids: new Set(), cursor: "", more: true, total: 0, pages: 0 };
  }
  while (state.comments.length <= start && state.more && state.pages < COMMENTS_MAX_PAGES) {
    const cursor = state.cursor;
    const data = await commentPage(id, cursor);
    const rows = Array.isArray(data.comments) ? data.comments : [];
    const page = [];
    for (const raw of rows) {
      const mapped = commentOf(raw);
      if (mapped) page.push(mapped);
    }
    for (const comment of page) {
      if (state.ids.has(comment.id)) continue;
      state.ids.add(comment.id);
      state.comments.push(comment);
    }
    const total = Number(data.count);
    if (Number.isFinite(total) && total >= 0) state.total = Math.floor(total);
    const next = data.cursor === undefined || data.cursor === null ? "" : String(data.cursor);
    state.more = data.has_more === true && page.length > 0 && !!next && next !== cursor;
    state.cursor = next;
    state.pages++;
  }
  state.at = Date.now();
  commentsCache.delete(id);
  commentsCache.set(id, state);
  while (commentsCache.size > COMMENTS_CACHE_LIMIT) {
    const oldest = commentsCache.keys().next();
    if (oldest.done) break;
    commentsCache.delete(oldest.value);
  }
  const page = state.comments.slice(start, start + COMMENTS_PAGE).map((comment) => Object.assign({}, comment));
  return {
    comments: page,
    total: Math.max(state.total, state.comments.length),
    more: start + page.length < state.comments.length || (state.more && page.length > 0),
  };
}

export async function likeComment({ trackId, commentId, on }) {
  const id = asID(trackId);
  const comment = asID(commentId);
  if (!signedIn()) throw fail("signIn", "登录汽水音乐后才能给评论点赞");
  const liked = on === true;
  await signedPC("/luna/pc/comments/action", {
    comment_id: comment,
    reply_id: "",
    group_id: id,
    type: liked ? 1 : 3,
    scene_name: "comment_detail",
  });
  const state = commentsCache.get(id);
  if (!state) return;
  for (const item of state.comments) {
    if (item.id !== comment) continue;
    if (item.liked !== liked) {
      item.likes = Math.max(0, Number(item.likes || 0) + (liked ? 1 : -1));
      item.liked = liked;
    }
    break;
  }
}

export async function postComment({ trackId, text }) {
  const id = asID(trackId);
  if (!signedIn()) throw fail("signIn", "登录汽水音乐后才能发表评论");
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) throw new Error("评论内容不能为空");
  if (Array.from(value).length > 280) throw new Error("评论最多 280 个字符");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error("评论内容包含不支持的字符");
  const data = await signedPC("/luna/pc/comments/create", {
    group_id: id,
    group_type: 0,
    comment_type: 0,
    text: value,
    hashtags: [],
    reply_id: "",
    reply_to_reply_id: "",
    reply_to_user_id: "",
    text_extra: [],
  });
  const created = data.created_comment === undefined || data.created_comment === null ? "" : String(data.created_comment);
  if (!created || /^0+$/.test(created)) throw new Error("汽水音乐没有返回新评论的编号");
  commentsCache.delete(id);
  const profile = currentSession().profile || {};
  const comment = { id: created, author: profile.name || "我", text: value, time: Date.now(), likes: 0, liked: false };
  if (profile.imageUrl) comment.avatarUrl = profile.imageUrl;
  return comment;
}

// ---------- 播放地址 ----------
//
// 汽水音乐给 VIP 的完整音频（/luna/pc/track_v2）是 cenc-aes-ctr 加密的 M4A：
// 同一个响应里带着这首歌的播放密钥（encrypt_info.spade_a，服务端下发给已登录
// 客户端）。这里在插件内用纯 JavaScript 解密样本、把 enca 改成 mp4a，然后交给
// /usr/bin/base64 把明文写进插件数据目录，再用 file:// 交给 App 播放——不需要
// Node、不需要 Electron、也不需要 ffmpeg 转码。免费/匿名账号仍然走网页端
// seo_track 的明文地址（通常只有 30–60 秒试听），拿不到的曲目返回 unavailable。

// MyGo 的 quality 只有 standard / high / lossless 三档，映射到汽水的官方档位：
//   standard -> medium（官方「标准」AAC 64k）
//   high     -> higher（官方「高品」AAC 128k，下载量约一半，首播更快）
//   lossless -> lossless（官方「无损」FLAC-in-MP4，约 0.8–1.6Mbps，仅部分曲目有）
// 曲目没有所选档位时按顺序往下降级；hi_res 是 320k 的 AAC，空间音频不暴露。
const QUALITY_ORDER = {
  lossless: ["lossless", "hi_res", "highest", "higher", "medium"],
  high: ["higher", "highest", "hi_res", "medium"],
  standard: ["medium", "higher", "highest"],
};
const AUDIO_HOSTS = ["douyinvod.com", "douyincdn.com", "douyinpic.com", "qishui.com"];

function allowedAudioHost(url) {
  const match = /^https:\/\/([^\/?#]+)/i.exec(String(url || ""));
  if (!match) return false;
  const host = match[1].toLowerCase();
  return AUDIO_HOSTS.some((suffix) => host === suffix || host.endsWith("." + suffix));
}

function pickVideo(videos, order) {
  for (const quality of order) {
    const found = videos.find((item) => item && item.video_meta && item.video_meta.quality === quality && item.main_url);
    if (found) return found;
  }
  return videos.find((item) => item && item.main_url) || null;
}

// 两种接口的响应形状差不多：track_player.video_model 里是播放列表，曲目在
// seo_track.track（网页端）或 track（PC track_v2）。
function playbackOf(data) {
  const player = (data && data.track_player) || {};
  let model = player.video_model;
  if (typeof model === "string") {
    try {
      model = parseData(model);
    } catch (error) {
      model = null;
    }
  }
  const track = (data && data.track) || (data && data.seo_track && data.seo_track.track) || {};
  const videos = (model && Array.isArray(model.video_list) ? model.video_list : []).filter(
    (item) => item && item.main_url
  );
  return { track, model, videos };
}

function normalizeQuality(quality) {
  const value = String(quality || "").toLowerCase();
  if (value === "lossless") return "lossless";
  if (value === "standard" || value === "low") return "standard";
  return "high";
}

function qualityLabel(quality) {
  if (quality === "lossless") return "lossless";
  if (quality === "medium") return "standard";
  if (quality) return "high";
  return "";
}

function streamResult(url, type, meta, quality) {
  const result = {
    url,
    type: type || "m4a",
    headers: {},
    bitRate: Number(meta && meta.bitrate) || 0,
  };
  const label = qualityLabel(quality);
  if (label) result.quality = label;
  const size = Number(meta && meta.size);
  if (Number.isSafeInteger(size) && size > 0) result.size = size;
  return result;
}

function servedPreview(track, model) {
  const duration = Number(track && track.duration) || 0;
  const served = Math.round(Number(model && model.video_duration) || 0) * 1000;
  // 汽水只给 30/60 秒片段时 video_duration 明显小于曲目时长；差 5 秒以内算完整。
  return duration > 0 && served > 0 && duration - served > 5000;
}

// ---------- CENC-AES-CTR 解密（纯 JS） ----------
// 只处理汽水当前这种非分片 M4A：stbl 里 stsz/stsc/stco 给样本位置，senc 给每个
// 样本的 8 字节 IV，AES-CTR 的 counter 初值 = IV 后面补 8 个 0。

function readU32(b, at) {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function typeAt(b, at) {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

function findBox(list, type) {
  for (let i = 0; i < list.length; i++) if (list[i].type === type) return list[i];
  return null;
}

function childBoxes(b, start, end) {
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    let size = readU32(b, at);
    let header = 8;
    const type = typeAt(b, at + 4);
    if (size === 1) {
      size = readU32(b, at + 8) * 4294967296 + readU32(b, at + 12);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push({ type, at, data: at + header, end: at + size });
    at += size;
  }
  return out;
}

function renameBox(b, box, type) {
  for (let k = 0; k < 4; k++) b[box.at + 4 + k] = type.charCodeAt(k);
}

function sampleLayout(b, stsz, stsc, stco) {
  const defaultSize = readU32(b, stsz.data + 4);
  const count = readU32(b, stsz.data + 8);
  const sizes = new Uint32Array(count);
  for (let i = 0; i < count; i++) sizes[i] = defaultSize || readU32(b, stsz.data + 12 + i * 4);
  const runCount = readU32(b, stsc.data + 4);
  const runs = [];
  for (let i = 0; i < runCount; i++) {
    runs.push({ first: readU32(b, stsc.data + 8 + i * 12), per: readU32(b, stsc.data + 12 + i * 12) });
  }
  const chunkCount = readU32(b, stco.data + 4);
  const chunks = new Uint32Array(chunkCount);
  for (let i = 0; i < chunkCount; i++) chunks[i] = readU32(b, stco.data + 8 + i * 4);
  const offsets = new Uint32Array(count);
  let sample = 0;
  for (let r = 0; r < runs.length && sample < count; r++) {
    const from = runs[r].first;
    const to = r + 1 < runs.length ? runs[r + 1].first : chunkCount + 1;
    for (let chunk = from; chunk < to && sample < count; chunk++) {
      let at = chunks[chunk - 1];
      for (let k = 0; k < runs[r].per && sample < count; k++) {
        offsets[sample] = at;
        at += sizes[sample];
        sample++;
      }
    }
  }
  return { count, sizes, offsets };
}

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

function xtime(a) {
  a <<= 1;
  return a & 0x100 ? (a ^ 0x1b) & 0xff : a & 0xff;
}

function gmul(a, b) {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return r & 0xff;
}

const TE0 = new Uint32Array(256);
const TE1 = new Uint32Array(256);
const TE2 = new Uint32Array(256);
const TE3 = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  const s = SBOX[i];
  const s2 = gmul(s, 2);
  const s3 = gmul(s, 3);
  TE0[i] = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
  TE1[i] = ((s3 << 24) | (s2 << 16) | (s << 8) | s) >>> 0;
  TE2[i] = ((s << 24) | (s3 << 16) | (s2 << 8) | s) >>> 0;
  TE3[i] = ((s << 24) | (s << 16) | (s3 << 8) | s2) >>> 0;
}

function expandKey(key) {
  const rk = new Uint32Array(44);
  for (let i = 0; i < 4; i++) {
    rk[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  }
  let rcon = 1;
  for (let i = 4; i < 44; i++) {
    let t = rk[i - 1];
    if (i % 4 === 0) {
      t = ((SBOX[(t >>> 16) & 0xff] << 24) |
        (SBOX[(t >>> 8) & 0xff] << 16) |
        (SBOX[t & 0xff] << 8) |
        SBOX[(t >>> 24) & 0xff]) >>> 0;
      t = (t ^ (rcon << 24)) >>> 0;
      rcon = xtime(rcon);
    }
    rk[i] = (rk[i - 4] ^ t) >>> 0;
  }
  return rk;
}

const KS = new Uint32Array(4);

function encryptBlock(rk, s0, s1, s2, s3) {
  s0 = (s0 ^ rk[0]) >>> 0;
  s1 = (s1 ^ rk[1]) >>> 0;
  s2 = (s2 ^ rk[2]) >>> 0;
  s3 = (s3 ^ rk[3]) >>> 0;
  for (let r = 1; r < 10; r++) {
    const k = r * 4;
    const t0 = (TE0[s0 >>> 24] ^ TE1[(s1 >>> 16) & 0xff] ^ TE2[(s2 >>> 8) & 0xff] ^ TE3[s3 & 0xff] ^ rk[k]) >>> 0;
    const t1 = (TE0[s1 >>> 24] ^ TE1[(s2 >>> 16) & 0xff] ^ TE2[(s3 >>> 8) & 0xff] ^ TE3[s0 & 0xff] ^ rk[k + 1]) >>> 0;
    const t2 = (TE0[s2 >>> 24] ^ TE1[(s3 >>> 16) & 0xff] ^ TE2[(s0 >>> 8) & 0xff] ^ TE3[s1 & 0xff] ^ rk[k + 2]) >>> 0;
    const t3 = (TE0[s3 >>> 24] ^ TE1[(s0 >>> 16) & 0xff] ^ TE2[(s1 >>> 8) & 0xff] ^ TE3[s2 & 0xff] ^ rk[k + 3]) >>> 0;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    s3 = t3;
  }
  const k = 40;
  KS[0] = (((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 0xff] << 16) | (SBOX[(s2 >>> 8) & 0xff] << 8) | SBOX[s3 & 0xff]) ^ rk[k]) >>> 0;
  KS[1] = (((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 0xff] << 16) | (SBOX[(s3 >>> 8) & 0xff] << 8) | SBOX[s0 & 0xff]) ^ rk[k + 1]) >>> 0;
  KS[2] = (((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 0xff] << 16) | (SBOX[(s0 >>> 8) & 0xff] << 8) | SBOX[s1 & 0xff]) ^ rk[k + 2]) >>> 0;
  KS[3] = (((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 0xff] << 16) | (SBOX[(s1 >>> 8) & 0xff] << 8) | SBOX[s2 & 0xff]) ^ rk[k + 3]) >>> 0;
}

// AES-128-CTR：ctr 初值 = iv 8 字节 || 8 字节 0，按 128 位大端递增。
function ctrXOR(rk, iv, data, start, size) {
  let w0 = ((iv[0] << 24) | (iv[1] << 16) | (iv[2] << 8) | iv[3]) >>> 0;
  let w1 = ((iv[4] << 24) | (iv[5] << 16) | (iv[6] << 8) | iv[7]) >>> 0;
  let w2 = 0;
  let w3 = 0;
  let at = start;
  const end = start + size;
  while (at + 16 <= end) {
    encryptBlock(rk, w0, w1, w2, w3);
    data[at] ^= KS[0] >>> 24;
    data[at + 1] ^= (KS[0] >>> 16) & 0xff;
    data[at + 2] ^= (KS[0] >>> 8) & 0xff;
    data[at + 3] ^= KS[0] & 0xff;
    data[at + 4] ^= KS[1] >>> 24;
    data[at + 5] ^= (KS[1] >>> 16) & 0xff;
    data[at + 6] ^= (KS[1] >>> 8) & 0xff;
    data[at + 7] ^= KS[1] & 0xff;
    data[at + 8] ^= KS[2] >>> 24;
    data[at + 9] ^= (KS[2] >>> 16) & 0xff;
    data[at + 10] ^= (KS[2] >>> 8) & 0xff;
    data[at + 11] ^= KS[2] & 0xff;
    data[at + 12] ^= KS[3] >>> 24;
    data[at + 13] ^= (KS[3] >>> 16) & 0xff;
    data[at + 14] ^= (KS[3] >>> 8) & 0xff;
    data[at + 15] ^= KS[3] & 0xff;
    at += 16;
    w3 = (w3 + 1) >>> 0;
    if (w3 === 0) {
      w2 = (w2 + 1) >>> 0;
      if (w2 === 0) {
        w1 = (w1 + 1) >>> 0;
        if (w1 === 0) w0 = (w0 + 1) >>> 0;
      }
    }
  }
  if (at < end) {
    encryptBlock(rk, w0, w1, w2, w3);
    const rest = end - at;
    for (let k = 0; k < rest; k++) {
      const word = k < 4 ? KS[0] : k < 8 ? KS[1] : k < 12 ? KS[2] : KS[3];
      data[at + k] ^= (word >>> ((3 - (k % 4)) * 8)) & 0xff;
    }
  }
}

const B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64decode(text) {
  const clean = String(text || "").replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.ceil((clean.length * 3) / 4));
  let oi = 0;
  let i = 0;
  for (; i + 3 < clean.length; i += 4) {
    const a = B64CHARS.indexOf(clean[i]);
    const b = B64CHARS.indexOf(clean[i + 1]);
    const c = B64CHARS.indexOf(clean[i + 2]);
    const d = B64CHARS.indexOf(clean[i + 3]);
    out[oi++] = (a << 2) | (b >> 4);
    out[oi++] = ((b & 15) << 4) | (c >> 2);
    out[oi++] = ((c & 3) << 6) | d;
  }
  const rest = clean.length - i;
  if (rest >= 2) {
    const a = B64CHARS.indexOf(clean[i]);
    const b = B64CHARS.indexOf(clean[i + 1]);
    out[oi++] = (a << 2) | (b >> 4);
    if (rest >= 3) {
      const c = B64CHARS.indexOf(clean[i + 2]);
      out[oi++] = ((b & 15) << 4) | (c >> 2);
    }
  }
  return out.subarray(0, oi);
}

function b64encode(bytes) {
  const parts = [];
  const chunkBytes = 3 * 4096;
  for (let i = 0; i < bytes.length; i += chunkBytes) {
    const end = Math.min(i + chunkBytes, bytes.length);
    const count = end - i;
    const codes = new Array(Math.ceil(count / 3) * 4);
    let ci = 0;
    let j = i;
    for (; j + 2 < end; j += 3) {
      const a = bytes[j];
      const b = bytes[j + 1];
      const c = bytes[j + 2];
      codes[ci++] = B64CHARS.charCodeAt(a >> 2);
      codes[ci++] = B64CHARS.charCodeAt(((a & 3) << 4) | (b >> 4));
      codes[ci++] = B64CHARS.charCodeAt(((b & 15) << 2) | (c >> 6));
      codes[ci++] = B64CHARS.charCodeAt(c & 63);
    }
    if (j < end) {
      const a = bytes[j];
      const b = j + 1 < end ? bytes[j + 1] : 0;
      codes[ci++] = B64CHARS.charCodeAt(a >> 2);
      codes[ci++] = B64CHARS.charCodeAt(((a & 3) << 4) | (b >> 4));
      codes[ci++] = j + 1 < end ? B64CHARS.charCodeAt((b & 15) << 2) : 61;
      codes[ci++] = 61;
    }
    parts.push(String.fromCharCode.apply(null, codes));
  }
  return parts.join("");
}

// spade_a 是服务端播放密钥的传输编码：base64 -> 去填充 -> 异或/位移还原 ->
// 首字符 base36 是尾长 -> 剩下的十六进制是 16 字节 AES-128 密钥。
function playbackKey(spadeA) {
  const source = b64decode(spadeA);
  if (source.length < 4) throw new Error("播放密钥为空");
  const padding = (source[0] ^ source[1] ^ source[2]) - 48;
  const coded = source.subarray(1, source.length - padding);
  const plain = new Uint8Array(coded.length);
  for (let i = 0; i < coded.length; i++) {
    let count = 0;
    for (let bits = i; bits; bits >>>= 1) count += bits & 1;
    const previous = i < 2 ? [250, 85][i] : coded[i - 2];
    let byte = (coded[i] ^ previous) - count - 21;
    while (byte < 0) byte += 255;
    plain[i] = byte & 255;
  }
  const tail = Number.parseInt(String.fromCharCode(plain[0]), 36);
  const hex = String.fromCharCode.apply(null, Array.from(plain.subarray(1, plain.length - (tail || 0))));
  const key = new Uint8Array(hex.length / 2);
  for (let i = 0; i < key.length; i++) key[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return key;
}

function decryptM4A(data, spadeA) {
  const key = playbackKey(spadeA);
  if (key.length !== 16) throw new Error("播放密钥长度不对（" + key.length + " 字节）");
  const rk = expandKey(key);
  const top = childBoxes(data, 0, data.length);
  const moov = findBox(top, "moov");
  if (!moov) throw new Error("音频文件里没有 moov");
  let target = null;
  const traks = childBoxes(data, moov.data, moov.end).filter((box) => box.type === "trak");
  for (const trak of traks) {
    const mdia = findBox(childBoxes(data, trak.data, trak.end), "mdia");
    if (!mdia) continue;
    const minf = findBox(childBoxes(data, mdia.data, mdia.end), "minf");
    if (!minf) continue;
    const stbl = findBox(childBoxes(data, minf.data, minf.end), "stbl");
    if (!stbl) continue;
    const boxes = childBoxes(data, stbl.data, stbl.end);
    if (findBox(boxes, "senc")) {
      target = { boxes };
      break;
    }
    if (!target && findBox(boxes, "stsz")) target = { boxes };
  }
  if (!target) throw new Error("音频文件里没有可解密的音轨");
  const stsd = findBox(target.boxes, "stsd");
  const stsz = findBox(target.boxes, "stsz");
  const stsc = findBox(target.boxes, "stsc");
  const stco = findBox(target.boxes, "stco");
  const senc = findBox(target.boxes, "senc");
  if (!stsd || !stsz || !stsc || !stco) throw new Error("音频文件缺少样本表");
  if (!senc) throw new Error("音频文件没有加密样本信息");
  const sampleCount = readU32(data, senc.data + 4);
  if (!sampleCount) throw new Error("加密样本为空");
  const layout = sampleLayout(data, stsz, stsc, stco);
  if (layout.count !== sampleCount) throw new Error("样本数量不一致");
  const ivSize = Math.max(8, Math.min(16, Math.floor((senc.end - senc.data - 8) / sampleCount)));
  const iv = new Uint8Array(8);
  for (let i = 0; i < sampleCount; i++) {
    const ivBase = senc.data + 8 + i * ivSize;
    for (let k = 0; k < 8; k++) iv[k] = ivSize >= k + 1 ? data[ivBase + k] : 0;
    ctrXOR(rk, iv, data, layout.offsets[i], layout.sizes[i]);
  }
  // 让播放器把样本按明文处理：加密样本入口是 enca，原始格式在 sinf/frma 里
  // （AAC 是 mp4a，无损是 fLaC），必须还原成原格式，不能一律写成 mp4a，
  // 否则 FLAC-in-MP4 会被当成 AAC 解码而播放失败。
  const entry = stsd.data + 8;
  if (entry + 8 <= data.length) {
    const entrySize = readU32(data, entry);
    const extEnd = Math.min(entry + entrySize, data.length);
    const extensions = entry + 36 < extEnd ? childBoxes(data, entry + 36, extEnd) : [];
    let originalType = "mp4a";
    const sinfBox = findBox(extensions, "sinf");
    if (sinfBox) {
      const frma = findBox(childBoxes(data, sinfBox.data, sinfBox.end), "frma");
      if (frma && frma.data + 4 <= data.length) {
        const candidate = typeAt(data, frma.data);
        if (/^[A-Za-z0-9 ]{4}$/.test(candidate)) originalType = candidate;
      }
    }
    const entryType = typeAt(data, entry + 4);
    if (entryType === "enca" || entryType === "encf") {
      for (let k = 0; k < 4; k++) data[entry + 4 + k] = originalType.charCodeAt(k);
    }
    for (const box of extensions) {
      if (box.type === "sinf") renameBox(data, box, "free");
    }
  }
  for (const box of target.boxes) {
    if (box.type === "senc" || box.type === "saio" || box.type === "saiz") renameBox(data, box, "free");
  }
  return data;
}

// ---------- 完整音频的下载、解密、落盘 ----------

const PLAY_CACHE_KEY = "playCache";
const PLAY_CACHE_LIMIT = 8;
const BASE64_BIN = "/usr/bin/base64";

function playCache() {
  const saved = host.storage.get(PLAY_CACHE_KEY);
  return saved && typeof saved === "object" ? saved : {};
}

function savePlayCache(cache) {
  try {
    host.storage.set(PLAY_CACHE_KEY, cache);
  } catch (error) {
    // 缓存只是加速，写不进去不影响播放
  }
}

async function fetchBytes(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": APP_UA },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("汽水音乐下载音频失败（HTTP " + response.status + "）");
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("汽水音乐下载音频超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cacheResult(fileURL, entry, meta, fallbackQuality) {
  const result = {
    url: fileURL,
    type: entry.type || "m4a",
    headers: {},
    bitRate: Number(entry.bitRate) || Number(meta && meta.bitrate) || 0,
    quality: entry.quality || fallbackQuality || "high",
  };
  const size = Number(entry.size) || Number(meta && meta.size) || 0;
  if (Number.isSafeInteger(size) && size > 0) result.size = size;
  return result;
}

// 已经在磁盘上的整曲直接返回，不再请求 track_v2（省 ~300ms，重复播放基本瞬间开始）。
function cachedStream(trackID, requested) {
  // 磁盘缓存里是 macOS 上解密出来的 m4a；其它平台不做解密，也不该命中缓存。
  if (!onMac()) return null;
  const cache = playCache();
  const prefix = "audio-" + trackID + "-";
  for (const name of Object.keys(cache)) {
    if (name.indexOf(prefix) !== 0) continue;
    const entry = cache[name] || {};
    if (normalizeQuality(entry.request) !== requested) continue;
    const fileURL = fileURLFor(dataPath(name));
    return cacheResult(fileURL, entry, null, requested);
  }
  return null;
}

async function deliverEncrypted(picked, trackID, requested) {
  if (!onMac()) throw fail("setup", PLATFORM_MESSAGE);
  const meta = picked.video_meta || {};
  const encrypt = picked.encrypt_info || {};
  const quality = String(meta.quality || "medium");
  const label = qualityLabel(quality);
  const name = "audio-" + trackID + "-" + quality + ".m4a";
  const path = dataPath(name);
  const fileURL = fileURLFor(path);
  const cache = playCache();
  const saved = cache[name];
  if (saved && saved.at) return cacheResult(fileURL, saved, meta, label);
  let proc;
  try {
    proc = await host.spawn(BASE64_BIN, ["-D", "-o", path]);
  } catch (error) {
    const message = String((error && error.message) || error);
    if (/allowed/i.test(message)) {
      throw fail(
        "setup",
        "播放完整歌曲需要允许插件启动 base64 命令：设置 → 汽水音乐 → Allow Programs（允许启动程序），然后重试"
      );
    }
    if (/process permission/i.test(message)) {
      throw fail("setup", "插件没有启动 base64 命令的权限，请重新安装最新版本的插件");
    }
    throw fail("unavailable", "启动解码程序失败：" + message);
  }
  try {
    const encrypted = await fetchBytes(picked.main_url, 20000);
    const plain = decryptM4A(encrypted, String(encrypt.spade_a || ""));
    // base64 分块边编边写：每块字节数是 3 的倍数，拼接后仍是合法 base64，
    // 避免一次生成几 MB 的字符串把 Goja 的内存和 GC 拖慢。
    const chunkBytes = 3 * 16384;
    for (let at = 0; at < plain.length; at += chunkBytes) {
      proc.write(b64encode(plain.subarray(at, Math.min(at + chunkBytes, plain.length))));
    }
    proc.closeStdin();
    const code = await proc.wait();
    if (code !== 0) {
      const why = String(proc.errorOutput() || "").trim();
      throw fail("unavailable", "音频写入失败（" + (why || "base64 退出码 " + code + "）"));
    }
    const entry = {
      at: Date.now(),
      bitRate: Number(meta.bitrate) || 0,
      size: plain.length,
      quality: label || "high",
      request: normalizeQuality(requested),
      type: "m4a",
    };
    cache[name] = entry;
    const names = Object.keys(cache).filter((key) => key !== name);
    if (names.length >= PLAY_CACHE_LIMIT) {
      names.sort((a, b) => (Number(cache[a].at) || 0) - (Number(cache[b].at) || 0));
      for (const old of names.slice(0, names.length - PLAY_CACHE_LIMIT + 1)) {
        try {
          host.removeDataDir(old);
        } catch (error) {
          // 删不掉就等下次
        }
        delete cache[old];
      }
    }
    savePlayCache(cache);
    return cacheResult(fileURL, entry, meta, label);
  } catch (error) {
    try {
      proc.kill();
    } catch (ignored) {
      // 已经结束了
    }
    try {
      host.removeDataDir(name);
    } catch (ignored) {
      // 删不掉下次会覆盖
    }
    throw error;
  }
}

// 签名一次 ~300ms，同一首歌重复播放时直接复用刚拿到的整曲信息（只在内存里）。
const TRACK_CACHE_TTL = 10 * 60 * 1000;
const TRACK_CACHE_LIMIT = 12;
const trackV2Cache = {};

async function trackV2(trackID) {
  const saved = trackV2Cache[trackID];
  if (saved && Date.now() - saved.at < TRACK_CACHE_TTL) return saved.data;
  const data = await signedPC("/luna/pc/track_v2", {
    track_id: trackID,
    media_type: "track",
    queue_type: "favorite_track_playlist",
    scene_name: "library",
  });
  const keys = Object.keys(trackV2Cache);
  if (keys.length >= TRACK_CACHE_LIMIT) delete trackV2Cache[keys[0]];
  trackV2Cache[trackID] = { at: Date.now(), data };
  return data;
}

export async function stream({ id, quality }) {
  const trackID = asID(id);
  const requested = normalizeQuality(quality);
  const order = QUALITY_ORDER[requested] || QUALITY_ORDER.standard;
  const cached = cachedStream(trackID, requested);
  if (cached) return cached;
  const active = signedIn();
  let fullError = null;
  // 非 macOS 平台没有官方签名模块：跳过 track_v2，直接走匿名网页接口（可播普通曲目）。
  if (active && onMac()) {
    try {
      const full = await trackV2(trackID);
      const info = playbackOf(full);
      if (info.videos.length && !servedPreview(info.track, info.model)) {
        const picked = pickVideo(info.videos, order);
        if (picked) {
          const encrypt = picked.encrypt_info || {};
          const meta = picked.video_meta || {};
          if (encrypt.spade_a && encrypt.encrypt !== false) {
            return await deliverEncrypted(picked, trackID, requested);
          }
          const url = String(picked.main_url);
          if (allowedAudioHost(url)) {
            return streamResult(url, meta.vtype ? String(meta.vtype) : "m4a", meta, meta.quality);
          }
        }
      }
    } catch (error) {
      if (error && error.code === "signIn") throw error;
      fullError = error;
    }
  }
  // 签名不可用（没装官方客户端 / 没允许启动程序）时，优先把这个原因告诉用户，
  // 而不是笼统的「只剩试听」。
  const finalError = function (error) {
    if (fullError && fullError.code === "setup") return fullError;
    return error;
  };
  const data = await seoTrack(trackID);
  const info = playbackOf(data);
  if (!info.videos.length) {
    throw finalError(fail("unavailable", "汽水音乐没有返回这首歌的播放地址，可能没有版权或需要会员"));
  }
  const picked = pickVideo(info.videos, order);
  if (!picked) throw finalError(fail("unavailable", "汽水音乐没有返回这首歌可用的音质"));
  const meta = picked.video_meta || {};
  const url = String(picked.main_url);
  if (!allowedAudioHost(url)) throw fail("unavailable", "汽水音乐返回了不受支持的播放地址");
  if (servedPreview(info.track, info.model)) {
    if (fullError && fullError.code === "unavailable") throw fullError;
    if (!active) throw fail("signIn", "登录汽水音乐后才能播放完整歌曲");
    if (!onMac()) {
      throw fail("unavailable", "这首歌在汽水音乐只提供试听片段（会员专享）；Windows/Linux 版暂不支持播放完整版");
    }
    throw finalError(
      fail("unavailable", "这首歌在汽水音乐只提供试听片段（会员或购买专享），暂时无法完整播放")
    );
  }
  return streamResult(url, meta.vtype ? String(meta.vtype) : "m4a", meta, meta.quality);
}
