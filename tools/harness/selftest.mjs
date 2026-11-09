#!/usr/bin/env node
// Self-test for the harness: validators against good/bad fixtures plus an
// end-to-end run of tools/harness/mock-plugin (fetch + host mocks) and a
// plugin that wrongly uses Node's Buffer (must be reported as a failure).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHarness } from "./run.mjs";
import {
  validateManifest, validateBrowse, validateSearchResult, validateStream,
  validateTrack
} from "./lib/contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK_PLUGIN = path.join(HERE, "mock-plugin");
let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    process.stdout.write("  PASS  " + name + "\n");
  } else {
    failures++;
    process.stdout.write("  FAIL  " + name + (detail ? "  (" + detail + ")" : "") + "\n");
  }
}

function errorsOf(validator, value, pathArg) {
  const r = { errors: [], warnings: [] };
  validator(value, r, pathArg || "result");
  return r;
}

async function main() {
  process.stdout.write("harness selftest\n\n  -- contract validators --\n");

  const goodBrowse = { title: "Home", sections: [{ title: "Hot", tracks: [{ id: "t1", name: "Song", album: { id: "a1", name: "Album" }, duration: 1000 }] }] };
  check("valid Browse passes", errorsOf(validateBrowse, goodBrowse).errors.length === 0);
  check("Browse with a string section fails", errorsOf(validateBrowse, { sections: ["x"] }).errors.length > 0);
  check("valid SearchResult passes", errorsOf(validateSearchResult, { tracks: goodBrowse.sections[0].tracks, more: false }, "result", "tracks").errors.length === 0);
  check("SearchResult with bad track fails", errorsOf(validateSearchResult, { tracks: [{ id: "t1" }] }).errors.length > 0);
  check("valid Stream passes", errorsOf(validateStream, { url: "https://cdn.example.com/a.m4a", type: "m4a" }).errors.length === 0);
  check("Stream with a relative url fails", errorsOf(validateStream, { url: "/a.m4a", type: "mp3" }).errors.length > 0);
  check("Track without album fails", errorsOf(validateTrack, { id: "t1", name: "Song", duration: 1 }).errors.length > 0);
  check("Track with duration in seconds warns but passes", errorsOf(validateTrack, { id: "t1", name: "Song", album: { id: "a", name: "A" } }).errors.length === 0);
  const manifest = { id: "harness-mock", name: "Mock", main: "index.js", playback: "stream", permissions: { network: ["api.example.com"] } };
  check("valid manifest passes", validateManifest(manifest).errors.length === 0);
  check("manifest with a bad id fails", validateManifest({ id: "../bad" }).errors.length > 0);

  process.stdout.write("\n  -- end-to-end: mock-plugin --\n");
  const good = await runHarness({ pluginDir: MOCK_PLUGIN, strict: true, quiet: true });
  check("mock-plugin loads and passes home/search/stream", good.ok, JSON.stringify(good.rows.filter((r) => r.status !== "PASS").slice(0, 3)));
  check("mock-plugin exports home/search/stream", ["home", "search", "stream"].every((name) => good.exports.includes(name)), good.exports.join(","));

  process.stdout.write("\n  -- end-to-end: plugin using Node's Buffer --\n");
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "mygo-harness-bad-"));
  fs.writeFileSync(path.join(badDir, "plugin.json"), JSON.stringify({ id: "bad-node", name: "Bad Node", main: "index.js", playback: "stream", permissions: { network: [] } }));
  fs.writeFileSync(path.join(badDir, "index.js"), [
    "export function home() {",
    "  return { title: Buffer.from(\"x\").toString(), sections: [] };",
    "}",
    ""
  ].join("\n"));
  const bad = await runHarness({ pluginDir: badDir, quiet: true });
  const badRow = bad.rows.find((row) => row.name === "home");
  check("Node Buffer use is reported as a failed export", !!badRow && badRow.status === "FAIL", badRow ? badRow.detail : "no home row");
  check("the bad plugin run is not OK", bad.ok === false);

  process.stdout.write("\n" + (failures === 0 ? "selftest: OK" : "selftest: " + failures + " failure(s)") + "\n");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write("selftest crashed: " + String((err && err.stack) || err) + "\n");
  process.exit(2);
});
