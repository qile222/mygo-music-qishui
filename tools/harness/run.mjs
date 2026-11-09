#!/usr/bin/env node
// Headless structure check for a MyGo Music plugin (0.1.22 contract).
// Usage: node --experimental-vm-modules tools/harness/run.mjs --plugin .
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlugin, withTimeout, assertVmModules } from "./lib/loader.mjs";
import { EXPORTS, REQUIRED_EXPORTS, validateManifest, validateResult } from "./lib/contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const options = {
    pluginDir: ".",
    only: null,
    strict: false,
    verbose: false,
    json: false,
    quiet: false,
    settings: {},
    language: "zh-CN",
    routesFile: null,
    timeoutMs: 10000
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--plugin" || arg === "-p") options.pluginDir = argv[++i];
    else if (arg === "--only") options.only = String(argv[++i]).split(",").map((x) => x.trim()).filter(Boolean);
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--quiet" || arg === "-q") options.quiet = true;
    else if (arg === "--setting") {
      const pair = String(argv[++i]);
      const eq = pair.indexOf("=");
      if (eq === -1) throw new Error("--setting needs key=value, got: " + pair);
      options.settings[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === "--language") options.language = argv[++i];
    else if (arg === "--routes") options.routesFile = argv[++i];
    else if (arg === "--timeout") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error("unknown argument: " + arg + " (try --help)");
    }
  }
  if (options.timeoutMs !== options.timeoutMs || options.timeoutMs <= 0) options.timeoutMs = 10000;
  return options;
}

function printHelp() {
  process.stdout.write([
    "MyGo Music plugin harness (0.1.22 contract)",
    "",
    "  node --experimental-vm-modules tools/harness/run.mjs [options]",
    "",
    "Options:",
    "  --plugin, -p <dir>   plugin folder with plugin.json (default: .)",
    "  --only <a,b>         run only these exports (e.g. home,search,stream)",
    "  --strict             home/search/stream must exist and pass; unhandled fetch fails",
    "  --setting k=v        mock host.setting(key) value, repeatable",
    "  --language <lang>    mock host.language() (default zh-CN)",
    "  --routes <file>      fetch routes fixture (default tools/harness/fixtures/routes.json)",
    "  --timeout <ms>       per-call timeout (default 10000)",
    "  --verbose, -v        print host logs, warnings and PASS details",
    "  --json               print a JSON report instead of text",
    "  --quiet, -q          no output (useful from other scripts)",
    "",
    "The vm context only has the globals moejs/webapi give at runtime; Node's",
    "process/Buffer/require/crypto are absent on purpose. See tools/harness/README.md.",
    ""
  ].join("\n"));
}

export async function runHarness(inputOptions) {
  const options = Object.assign({ quiet: false, json: false, strict: false, verbose: false, timeoutMs: 10000 }, inputOptions || {});
  const report = {
    pluginDir: path.resolve(options.pluginDir),
    manifest: null,
    manifestWarnings: [],
    loadError: null,
    exports: [],
    rows: [],
    unhandledFetch: [],
    logs: 0,
    ok: false
  };
  const out = options.quiet ? function () {} : function (line) { process.stdout.write(line + "\n"); };
  const specFilter = options.only && options.only.length > 0 ? options.only : null;
  let specList = EXPORTS;
  if (specFilter) {
    specList = EXPORTS.filter((spec) => specFilter.some((wanted) => wanted === spec.name || wanted === spec.name + "["));
  }
  if (!options.quiet) {
    out("");
    out("MyGo plugin harness - plugin: " + report.pluginDir);
  }

  let loaded;
  try {
    loaded = await loadPlugin({
      pluginDir: report.pluginDir,
      settings: options.settings,
      language: options.language,
      routesFile: options.routesFile,
      timeoutMs: options.timeoutMs,
      verbose: options.verbose
    });
  } catch (err) {
    report.loadError = String((err && err.message) || err);
    if (!options.quiet) out("LOAD FAIL: " + report.loadError);
    if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report;
  }

  report.manifest = loaded.manifest;
  report.exports = loaded.exports;
  report.logs = loaded.logs.length;
  const manifestCheck = validateManifest(loaded.manifest);
  report.manifestWarnings = manifestCheck.warnings;
  let manifestOk = manifestCheck.errors.length === 0;
  for (const error of manifestCheck.errors) report.rows.push({ name: "plugin.json", status: "FAIL", ms: 0, detail: error, errors: [error], warnings: [] });
  if (!options.quiet) {
    out("  manifest: " + (manifestOk ? "OK" : "INVALID") + "  id=" + String(loaded.manifest.id) + " name=" + String(loaded.manifest.name || "") + " main=" + String(loaded.manifest.main || "index.js"));
    if (manifestOk && report.manifestWarnings.length > 0) out("  manifest warnings: " + report.manifestWarnings.join(" | "));
    out("  exported: " + (loaded.exports.length > 0 ? loaded.exports.join(", ") : "(none)"));
    out("");
  }

  for (const spec of specList) {
    if (!loaded.exports.includes(spec.name)) {
      const required = options.strict && REQUIRED_EXPORTS.includes(spec.name);
      report.rows.push({
        name: specLabel(spec),
        status: required ? "FAIL" : "SKIP",
        ms: 0,
        detail: required ? "required by --strict but the module does not export " + spec.name : "not exported",
        errors: [],
        warnings: []
      });
      if (!options.quiet) out("  " + pad(specLabel(spec), 22) + (required ? "FAIL" : "SKIP") + "  " + (required ? "required by --strict but not exported" : "not exported"));
      continue;
    }
    const fn = loaded.namespace[spec.name];
    if (typeof fn !== "function") {
      const message = "export " + spec.name + " is not a function (got " + typeof fn + ")";
      report.rows.push({ name: specLabel(spec), status: "FAIL", ms: 0, detail: message, errors: [message], warnings: [] });
      if (!options.quiet) out("  " + pad(specLabel(spec), 22) + "FAIL  " + message);
      continue;
    }
    for (const call of spec.calls) {
      const label = call.label ? spec.name + "[" + call.label + "]" : spec.name;
      const started = Date.now();
      let value;
      try {
        const params = call.params();
        const returned = fn.call(loaded.namespace, params);
        value = await withTimeout(Promise.resolve(returned), options.timeoutMs, label);
      } catch (err) {
        const ms = Date.now() - started;
        const info = classifyError(err);
        const status = info.skip ? "SKIP" : "FAIL";
        const errors = info.skip ? [] : [info.text];
        report.rows.push({ name: label, status: status, ms: ms, detail: info.text, errors: errors, warnings: [] });
        if (!options.quiet) out("  " + pad(label, 22) + status + "  " + ms + "ms  " + info.text);
        continue;
      }
      const ms = Date.now() - started;
      const kind = call.label && spec.name === "search" ? call.label : undefined;
      const check = validateResult(spec, value, kind);
      const status = check.errors.length > 0 ? "FAIL" : "PASS";
      const detail = describe(spec, value);
      report.rows.push({ name: label, status: status, ms: ms, detail: detail, errors: check.errors, warnings: check.warnings });
      if (!options.quiet) {
        out("  " + pad(label, 22) + status.padEnd(5) + " " + pad(ms + "ms", 7) + " " + detail);
        for (const warning of check.warnings) out("        warning: " + warning);
        for (const error of check.errors) out("        error: " + error);
      }
    }
  }

  report.unhandledFetch = loaded.fetchMock.unhandled.slice();
  if (report.unhandledFetch.length > 0 && !options.quiet) {
    out("");
    out("  fetch requests without a mock route (add them to the routes fixture):");
    for (const request of report.unhandledFetch.slice(0, 10)) out("    " + request.method + " " + request.url);
  }
  if (options.verbose && !options.quiet && loaded.logs.length > 0) {
    out("");
    out("  plugin console output:");
    for (const log of loaded.logs.slice(0, 40)) out("    " + log.line);
  }

  const counts = countRows(report.rows);
  const failFetch = options.strict && report.unhandledFetch.length > 0;
  report.ok = counts.fail === 0 && counts.error === 0 && manifestOk && !failFetch;
  if (!options.quiet) {
    out("");
    out("  summary: " + counts.pass + " passed, " + counts.fail + " failed, " + counts.skip + " skipped");
    if (!manifestOk) out("  plugin.json is invalid: fix the errors above");
    if (failFetch) out("  --strict: " + report.unhandledFetch.length + " fetch request(s) had no mock route");
    out("  result: " + (report.ok ? "OK" : "FAILED"));
  }
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report;
}

function specLabel(spec) {
  return spec.name;
}

function pad(text, width) {
  let result = String(text);
  while (result.length < width) result += " ";
  return result;
}

function countRows(rows) {
  const counts = { pass: 0, fail: 0, skip: 0, error: 0 };
  for (const row of rows) {
    if (row.status === "PASS") counts.pass++;
    else if (row.status === "FAIL") counts.fail++;
    else if (row.status === "SKIP") counts.skip++;
    else counts.error++;
  }
  return counts;
}

function classifyError(err) {
  const message = String((err && err.message) || err);
  const code = err && typeof err.code === "string" ? err.code : "";
  const unsupported = code === "unsupported" || /not supported by this source/.test(message);
  const needsSignIn = code === "signIn" || /sign in first/.test(message);
  const text = code ? code + ": " + message : message;
  if (unsupported) return { skip: true, text: "unsupported: " + message };
  if (needsSignIn) return { skip: true, text: "needs sign-in (mock host cannot sign in)" };
  return { skip: false, text: text };
}

function describe(spec, value) {
  if (value === null || value === undefined) return "null";
  if (spec.name === "home" || spec.name === "browse") {
    const count = Array.isArray(value.sections) ? value.sections.length : 0;
    return count + " section(s), title=" + JSON.stringify(value.title || null);
  }
  if (spec.name === "search") {
    const parts = [];
    for (const key of ["tracks", "albums", "artists", "playlists", "shows"]) {
      if (Array.isArray(value[key]) && value[key].length > 0) parts.push(key + "=" + value[key].length);
    }
    return (parts.length > 0 ? parts.join(" ") : "empty") + ", more=" + String(value.more === true);
  }
  if (spec.name === "stream") {
    let host = "";
    try {
      host = new URL(String(value.url)).host;
    } catch (err) {
      host = "?";
    }
    return "type=" + String(value.type) + " host=" + host;
  }
  if (Array.isArray(value)) return value.length + " item(s)";
  if (typeof value === "object") return Object.keys(value).slice(0, 6).join(",") || "{}";
  return JSON.stringify(value);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let options = null;
  try {
    assertVmModules();
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(String((err && err.message) || err) + "\n");
    process.exit(2);
  }
  runHarness(options).then((report) => {
    process.exit(report.ok ? 0 : 1);
  }).catch((err) => {
    process.stderr.write("harness crashed: " + String((err && err.stack) || err) + "\n");
    process.exit(2);
  });
}
