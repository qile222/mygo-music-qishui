// Fetch stand-in driven by a routes fixture. The real runtime goes through
// moejs/webapi and checks permissions.network; here the fixture file is the
// permission boundary: anything without a route is reported as unhandled.
import fs from "node:fs";
import path from "node:path";

export function createMockFetch(options) {
  const opts = options || {};
  const routesFile = opts.routesFile ? path.resolve(opts.routesFile) : null;
  const routes = loadRoutes(routesFile);
  const baseDir = routesFile ? path.dirname(routesFile) : process.cwd();
  const requests = [];
  const unhandled = [];
  const verbose = opts.verbose === true;

  async function mockFetch(input, init) {
    const requestInit = init || {};
    const url = requestUrl(input);
    const method = String(requestInit.method || requestMethod(input) || "GET").toUpperCase();
    requests.push({ method: method, url: url });
    const route = routes.find((candidate) => matches(candidate, method, url));
    if (!route) {
      unhandled.push({ method: method, url: url });
      if (verbose) process.stderr.write("[harness] fetch unhandled: " + method + " " + url + "\n");
      return new Response(JSON.stringify({ error: "no mock route", method: method, url: url }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    if (route.delayMs) await delay(route.delayMs);
    if (route.error) throw new TypeError("fetch failed");
    let body = null;
    const headers = Object.assign({}, route.headers || {});
    if (Object.prototype.hasOwnProperty.call(route, "json")) {
      body = JSON.stringify(route.json);
      if (!headers["content-type"]) headers["content-type"] = "application/json";
    } else if (Object.prototype.hasOwnProperty.call(route, "body")) {
      body = String(route.body);
    } else if (route.file) {
      body = fs.readFileSync(path.resolve(baseDir, route.file));
      if (!headers["content-type"]) headers["content-type"] = "application/octet-stream";
    }
    if (verbose) process.stderr.write("[harness] fetch " + method + " " + url + " -> " + (route.status || 200) + "\n");
    return new Response(body, { status: route.status || 200, headers: headers });
  }

  mockFetch.requests = requests;
  mockFetch.unhandled = unhandled;
  mockFetch.routesFile = routesFile;
  return mockFetch;
}

function loadRoutes(file) {
  if (!file) throw new Error("harness: no routes file given");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const routes = Array.isArray(parsed) ? parsed : parsed.routes;
  if (!Array.isArray(routes)) throw new Error("harness: routes file must hold an array or {routes: [...]}: " + file);
  return routes;
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  if (input instanceof URL) return input.href;
  return String(input);
}

function requestMethod(input) {
  return input && typeof input.method === "string" ? input.method : null;
}

function matches(route, method, url) {
  if (route.method && String(route.method).toUpperCase() !== method) return false;
  if (route.urlRegex) return new RegExp(route.urlRegex).test(url);
  if (route.url) return url.indexOf(String(route.url)) !== -1;
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
