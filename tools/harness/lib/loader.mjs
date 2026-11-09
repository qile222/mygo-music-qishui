// Loads a MyGo plugin's single ES module in an isolated vm context whose
// globals mirror what moejs + moejs/webapi expose to plugins. Deliberately
// absent: process, Buffer, require, import(), node:* modules and a crypto
// global - a plugin that uses them fails here, just as it would in MyGo.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createMockHost } from "./mock-host.mjs";
import { createMockFetch } from "./mock-fetch.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_ROUTES = path.join(HARNESS_ROOT, "fixtures", "routes.json");

export function assertVmModules() {
  if (typeof vm.SourceTextModule !== "function") {
    throw new Error(
      "This harness needs node --experimental-vm-modules (Node >= 18). Example:\n" +
      "  node --experimental-vm-modules tools/harness/run.mjs --plugin ."
    );
  }
}

export async function loadPlugin(options) {
  const opts = options || {};
  assertVmModules();
  const pluginDir = path.resolve(opts.pluginDir || ".");
  const manifestPath = path.join(pluginDir, "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const main = manifest.main || "index.js";
  if (typeof main !== "string") throw new Error("harness: plugin.json main must be a string");
  if (/\.ts$/.test(main)) {
    throw new Error("harness: TypeScript mains are compiled by moejs; the harness only runs .js builds (main=" + main + ")");
  }
  const mainPath = path.resolve(pluginDir, main);
  if (mainPath !== pluginDir && !mainPath.startsWith(pluginDir + path.sep)) {
    throw new Error("harness: plugin.json main must stay inside the plugin folder (main=" + main + ")");
  }
  const code = fs.readFileSync(mainPath, "utf8");

  const hostBundle = createMockHost({
    pluginDir: pluginDir,
    settings: opts.settings || {},
    language: opts.language || "zh-CN",
    storageSeed: opts.storageSeed || {}
  });
  const mockFetch = createMockFetch({
    routesFile: opts.routesFile || DEFAULT_ROUTES,
    verbose: opts.verbose === true
  });
  const logs = [];
  const context = vm.createContext(buildGlobals({
    host: hostBundle.host,
    fetchImpl: mockFetch,
    logs: logs,
    verbose: opts.verbose === true
  }), { name: "mygo-plugin:" + (manifest.id || "?") });

  const mod = new vm.SourceTextModule(code, {
    context: context,
    identifier: pathToFileURL(mainPath).href
  });
  await mod.link(async function (specifier) {
    throw new Error("harness: a MyGo plugin is a single module; import is not available (tried \"" + specifier + "\")");
  });
  const started = Date.now();
  await withTimeout(mod.evaluate(), opts.timeoutMs || 10000, "module evaluation");
  return {
    manifest: manifest,
    mainPath: mainPath,
    namespace: mod.namespace,
    host: hostBundle.host,
    hostState: hostBundle.state,
    fetchMock: mockFetch,
    logs: logs,
    evaluateMs: Date.now() - started,
    exports: exportNames(mod.namespace)
  };
}

export function withTimeout(promise, ms, what) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("harness: timed out after " + ms + "ms waiting for " + what)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function exportNames(namespace) {
  const names = Object.keys(namespace);
  return names.filter((name) => name !== "default").sort();
}

function buildGlobals(parts) {
  const logs = parts.logs;
  const console = {};
  for (const level of ["log", "info", "warn", "error"]) {
    console[level] = function () {
      const args = Array.prototype.slice.call(arguments).map((value) => String(value));
      const line = "[plugin] " + args.join(" ");
      logs.push({ level: level, line: line });
      if (parts.verbose) process.stderr.write(line + "\n");
    };
  }
  const globals = {
    console: console,
    host: parts.host,
    fetch: function () {
      return parts.fetchImpl.apply(null, arguments);
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    setImmediate: setImmediate,
    clearImmediate: clearImmediate,
    queueMicrotask: queueMicrotask,
    structuredClone: structuredClone,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    atob: atob,
    btoa: btoa,
    URL: URL,
    URLSearchParams: URLSearchParams,
    AbortController: AbortController,
    AbortSignal: AbortSignal,
    DOMException: DOMException,
    Event: Event,
    EventTarget: EventTarget,
    Performance: Performance,
    performance: performance,
    Headers: Headers,
    Request: Request,
    Response: Response,
    ReadableStream: ReadableStream,
    WritableStream: WritableStream,
    TransformStream: TransformStream
  };
  const optional = {
    TextDecoderStream: typeof TextDecoderStream !== "undefined" ? TextDecoderStream : undefined,
    TextEncoderStream: typeof TextEncoderStream !== "undefined" ? TextEncoderStream : undefined,
    ByteLengthQueuingStrategy: typeof ByteLengthQueuingStrategy !== "undefined" ? ByteLengthQueuingStrategy : undefined,
    CountQueuingStrategy: typeof CountQueuingStrategy !== "undefined" ? CountQueuingStrategy : undefined
  };
  for (const key of Object.keys(optional)) {
    if (optional[key] !== undefined) globals[key] = optional[key];
  }
  return globals;
}
