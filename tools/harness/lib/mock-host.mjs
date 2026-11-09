// In-memory stand-in for the global "host" object that mygo-music installs
// (internal/plugin/host.go). It mirrors the parts a plugin can use without
// a running MyGo app; the WebView / subprocess APIs throw on purpose.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GOARCH = { x64: "amd64", ia32: "386", arm: "arm", arm64: "arm64" };

export function createMockHost(options) {
  const opts = options || {};
  const pluginDir = path.resolve(opts.pluginDir || ".");
  const settings = Object.assign({}, opts.settings || {});
  const language = opts.language || "zh-CN";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mygo-harness-data-"));
  const storage = new Map();
  for (const key of Object.keys(opts.storageSeed || {})) {
    storage.set(key, clone(opts.storageSeed[key]));
  }
  const translations = loadTranslations(pluginDir, language);
  const state = {
    dataDir: dataDir,
    openedUrls: [],
    signInPrompts: [],
    removedDataDirs: [],
    storage: storage,
    settings: settings
  };

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function unsafe(name) {
    return new Error("harness: host." + name + " is not available (needs the real MyGo runtime)");
  }

  const host = {
    platform: mapPlatform(process.platform),
    arch: GOARCH[process.arch] || process.arch,
    dir: pluginDir,
    dataDir: dataDir,
    storage: {
      get: function (key) {
        if (typeof key !== "string") throw new TypeError("harness: storage.get(key) needs a string");
        if (!storage.has(key)) return undefined;
        return clone(storage.get(key));
      },
      set: function (key, value) {
        if (typeof key !== "string") throw new TypeError("harness: storage.set(key, value) needs a string key");
        if (value === undefined) throw new TypeError("harness: storage.set(key, undefined): JSON cannot hold undefined");
        storage.set(key, clone(value));
        return undefined;
      },
      remove: function (key) {
        storage.delete(key);
        return undefined;
      }
    },
    language: function () {
      return language;
    },
    t: function (text) {
      return Object.prototype.hasOwnProperty.call(translations, text) ? translations[text] : text;
    },
    setting: function (key) {
      return Object.prototype.hasOwnProperty.call(settings, key) ? String(settings[key]) : "";
    },
    openURL: function (url) {
      const parsed = parseUrl(url);
      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        throw new Error("not a web address: " + String(url));
      }
      state.openedUrls.push(String(url));
      return undefined;
    },
    signInPrompt: function (prompt) {
      state.signInPrompts.push(prompt);
      return undefined;
    },
    crypto: {
      md5: function (text) {
        return crypto.createHash("md5").update(String(text), "utf8").digest("hex");
      },
      aesEcbEncrypt: function (key, text) {
        const keyText = String(key);
        const keyLen = Buffer.byteLength(keyText, "utf8");
        if (keyLen !== 16 && keyLen !== 24 && keyLen !== 32) {
          throw new Error("harness: aesEcbEncrypt needs a 16/24/32 byte key");
        }
        const cipher = crypto.createCipheriv("aes-" + keyLen * 8 + "-ecb", Buffer.from(keyText, "utf8"), null);
        return Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]).toString("hex");
      }
    },
    removeDataDir: function (name) {
      if (typeof name !== "string" || name === "." || path.isAbsolute(name)) {
        throw new Error("not a folder of the plugin's data: " + String(name));
      }
      const target = path.resolve(dataDir, name);
      if (target !== dataDir && !target.startsWith(dataDir + path.sep)) {
        throw new Error("not a folder of the plugin's data: " + String(name));
      }
      fs.rmSync(target, { recursive: true, force: true });
      state.removedDataDirs.push(name);
      return undefined;
    },
    webSignIn: function () {
      throw unsafe("webSignIn");
    },
    waitForRedirect: function () {
      throw unsafe("waitForRedirect");
    },
    spawn: function () {
      throw unsafe("spawn");
    }
  };

  return { host: host, state: state };
}

function mapPlatform(value) {
  if (value === "darwin" || value === "linux" || value === "win32") {
    return value === "win32" ? "windows" : value;
  }
  return value;
}

function parseUrl(value) {
  try {
    return new URL(String(value));
  } catch (err) {
    return null;
  }
}

function loadTranslations(pluginDir, language) {
  if (language === "en") return {};
  const file = path.join(pluginDir, "locales", language + ".json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}
