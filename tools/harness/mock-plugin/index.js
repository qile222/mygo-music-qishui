// Mock plugin for tools/harness/selftest.mjs. It only uses APIs the real
// MyGo Music 0.1.22 runtime provides (fetch, URL, host.storage), so the same
// file also loads in the app - but the URLs are fixture-only.
const API = "https://api.example.com";

async function call(pathname, params) {
  const url = new URL(pathname, API);
  const entries = Object.entries(params || {});
  for (const entry of entries) {
    url.searchParams.set(entry[0], String(entry[1]));
  }
  const response = await fetch(url.href);
  if (!response.ok) {
    throw new Error("mock api " + url.pathname + " returned " + response.status);
  }
  return response.json();
}

export async function home() {
  return call("/home");
}

export async function search(params) {
  return call("/search", { q: params.query, kind: params.kind, offset: params.offset });
}

export async function stream(params) {
  const data = await call("/stream", { id: params.id, quality: params.quality });
  const token = await host.storage.get("token");
  return {
    url: data.url,
    type: data.type,
    quality: params.quality,
    size: data.size,
    headers: { cookie: "session=" + (token || "harness") }
  };
}

export async function account() {
  const token = await host.storage.get("token");
  return token ? { id: "harness-user", name: "Harness User" } : null;
}

export async function lyrics() {
  return { lrc: "[00:00.00]Harness lyric line\n[00:02.00]Second line" };
}

export async function isLiked(params) {
  const ids = Array.isArray(params.ids) ? params.ids : [];
  const liked = {};
  for (const id of ids) liked[id] = false;
  return liked;
}
