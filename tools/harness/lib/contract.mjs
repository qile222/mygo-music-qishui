// Structural checks for the JSON that MyGo Music 0.1.22 expects from plugin
// exports. Field names come from internal/music/music.go (see docs/RUNTIME.md
// sections 3.2-3.4). Validators return { errors, warnings } and never throw.

export const STREAM_TYPES = ["mp3", "flac", "ogg", "wav", "m4a", "aac"];
export const QUALITIES = ["standard", "high", "lossless"];
export const SEARCH_KINDS = ["tracks", "albums", "artists", "playlists", "shows"];
export const REQUIRED_EXPORTS = ["home", "search", "stream"];

export function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
export function isStr(v) {
  return typeof v === "string";
}
export function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
export function isBool(v) {
  return typeof v === "boolean";
}
export function isArr(v) {
  return Array.isArray(v);
}

function result() {
  return { errors: [], warnings: [] };
}

function join(path, key) {
  return path ? path + "." + key : key;
}

// Checks that a result can survive the JSON round-trip the runtime does.
export function checkSerializable(value, r, path) {
  const seen = new Set();
  function walk(v, p) {
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
      if (typeof v === "number" && !Number.isFinite(v)) r.errors.push(p + ": number is not finite (JSON cannot hold it)");
      return;
    }
    if (typeof v === "function") {
      r.errors.push(p + ": a function cannot be returned, the runtime encodes JSON");
      return;
    }
    if (typeof v === "undefined") {
      r.errors.push(p + ": undefined cannot be returned (use null)");
      return;
    }
    if (typeof v === "bigint") {
      r.errors.push(p + ": bigint cannot be returned (use number or string)");
      return;
    }
    if (typeof v !== "object") {
      r.errors.push(p + ": " + typeof v + " cannot be returned");
      return;
    }
    if (seen.has(v)) {
      r.errors.push(p + ": circular reference, JSON cannot encode it");
      return;
    }
    seen.add(v);
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, p + "[" + i + "]"));
    } else {
      for (const key of Object.keys(v)) walk(v[key], join(p, key));
    }
    seen.delete(v);
  }
  walk(value, path || "result");
}

function checkFields(obj, allowed, r, path) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) r.warnings.push(join(path, key) + ": unknown field (typo?");
  }
}

function reqStr(obj, key, r, path, nonEmpty) {
  const value = obj[key];
  if (value === undefined || value === null) {
    r.errors.push(join(path, key) + ": required string is missing");
    return;
  }
  if (typeof value !== "string") {
    r.errors.push(join(path, key) + ": must be a string, got " + typeof value);
    return;
  }
  if (nonEmpty && value.length === 0) r.errors.push(join(path, key) + ": must not be empty");
}

function optStr(obj, key, r, path) {
  const value = obj[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    r.errors.push(join(path, key) + ": must be a string when present");
  }
}

function optBool(obj, key, r, path) {
  const value = obj[key];
  if (value !== undefined && value !== null && typeof value !== "boolean") {
    r.errors.push(join(path, key) + ": must be a boolean when present");
  }
}

function optNum(obj, key, r, path) {
  const value = obj[key];
  if (value !== undefined && value !== null && typeof value !== "number") {
    r.errors.push(join(path, key) + ": must be a number when present");
  }
}

function optArr(obj, key, r, path) {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    r.errors.push(join(path, key) + ": must be an array when present");
    return undefined;
  }
  return value;
}

function each(value, r, path, validate, label) {
  value.forEach((item, i) => validate(item, r, path + "[" + i + "]", label));
}

export function validateManifest(m, r0) {
  const r = r0 || result();
  if (!isObj(m)) {
    r.errors.push("plugin.json: must be a JSON object");
    return r;
  }
  const id = m.id;
  if (!isStr(id) || id.length === 0) {
    r.errors.push("plugin.json id: required string");
  } else if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) {
    r.errors.push("plugin.json id: must match ^[A-Za-z0-9][A-Za-z0-9_.-]*$");
  }
  optStr(m, "name", r, "plugin.json");
  optStr(m, "version", r, "plugin.json");
  optStr(m, "minAppVersion", r, "plugin.json");
  optStr(m, "main", r, "plugin.json");
  if (m.main !== undefined && typeof m.main === "string") {
    if (m.main.startsWith("/") || m.main.includes("..")) {
      r.errors.push("plugin.json main: must be a file inside the plugin folder");
    }
    if (!/\.(js|mjs|ts)$/.test(m.main)) r.warnings.push("plugin.json main: expected a .js/.mjs/.ts file");
  }
  if (m.playback !== undefined && m.playback !== "stream" && m.playback !== "remote") {
    r.errors.push("plugin.json playback: must be \"stream\" or \"remote\"");
  }
  if (m.permissions !== undefined) {
    if (!isObj(m.permissions)) {
      r.errors.push("plugin.json permissions: must be an object");
    } else {
      const network = m.permissions.network;
      if (network !== undefined && !Array.isArray(network)) {
        r.errors.push("plugin.json permissions.network: must be an array of hosts");
      } else if (Array.isArray(network)) {
        network.forEach((host, i) => {
          if (typeof host !== "string" || host.length === 0) r.errors.push("plugin.json permissions.network[" + i + "]: must be a non-empty string");
        });
      }
      const processPerm = m.permissions.process;
      if (processPerm !== undefined && processPerm !== true && !Array.isArray(processPerm)) {
        r.errors.push("plugin.json permissions.process: must be an array (or true)");
      }
    }
  }
  if (m.navigation !== undefined) {
    if (!isArr(m.navigation)) {
      r.errors.push("plugin.json navigation: must be an array");
    } else {
      m.navigation.forEach((item, i) => {
        if (!isObj(item)) {
          r.errors.push("plugin.json navigation[" + i + "]: must be an object");
          return;
        }
        if (typeof item.title !== "string") r.errors.push("plugin.json navigation[" + i + "].title: required string");
        if (item.builtin !== undefined && !["home", "liked", "savedAlbums", "stations", "shows"].includes(item.builtin)) {
          r.errors.push("plugin.json navigation[" + i + "].builtin: unknown value " + JSON.stringify(item.builtin));
        }
        if (item.page !== undefined && typeof item.page !== "string") r.errors.push("plugin.json navigation[" + i + "].page: must be a string");
        if (item.page === undefined && item.builtin === undefined) r.warnings.push("plugin.json navigation[" + i + "]: needs builtin or page");
      });
    }
  }
  if (m.requestHeaders !== undefined) {
    if (!isArr(m.requestHeaders)) {
      r.errors.push("plugin.json requestHeaders: must be an array");
    } else {
      m.requestHeaders.forEach((rule, i) => {
        if (!isObj(rule)) {
          r.errors.push("plugin.json requestHeaders[" + i + "]: must be an object");
          return;
        }
        if (!isArr(rule.hosts) || rule.hosts.length === 0) r.errors.push("plugin.json requestHeaders[" + i + "].hosts: required non-empty array");
        if (!isObj(rule.headers) || Object.keys(rule.headers).length === 0) r.errors.push("plugin.json requestHeaders[" + i + "].headers: required non-empty object");
        if (rule.kinds !== undefined) {
          if (!isArr(rule.kinds)) r.errors.push("plugin.json requestHeaders[" + i + "].kinds: must be an array");
          else rule.kinds.forEach((kind) => {
            if (kind !== "image" && kind !== "audio") r.errors.push("plugin.json requestHeaders[" + i + "].kinds: " + JSON.stringify(kind) + " is not image or audio");
          });
        }
      });
    }
  }
  if (m.settings !== undefined) {
    if (!isArr(m.settings)) r.errors.push("plugin.json settings: must be an array");
    else m.settings.forEach((item, i) => {
      if (!isObj(item)) r.errors.push("plugin.json settings[" + i + "]: must be an object");
      else {
        if (typeof item.key !== "string") r.errors.push("plugin.json settings[" + i + "].key: required string");
        if (typeof item.label !== "string") r.errors.push("plugin.json settings[" + i + "].label: required string");
      }
    });
  }
  return r;
}

export function validateArtist(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  reqStr(v, "id", r, path, true);
  reqStr(v, "name", r, path, true);
  optStr(v, "imageUrl", r, path);
  optBool(v, "following", r, path);
  checkFields(v, ["id", "name", "imageUrl", "following"], r, path);
}

export function validateArtistArray(v, r, path) {
  if (!isArr(v)) {
    r.errors.push(path + ": must be an array of artists");
    return;
  }
  each(v, r, path, validateArtist, "artist");
}

export function validateAlbum(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  reqStr(v, "id", r, path, true);
  reqStr(v, "name", r, path, true);
  optStr(v, "imageUrl", r, path);
  optStr(v, "released", r, path);
  optBool(v, "saved", r, path);
  const artists = optArr(v, "artists", r, path);
  if (artists) each(artists, r, path + ".artists", validateArtist, "artist");
  checkFields(v, ["id", "name", "imageUrl", "artists", "released", "saved"], r, path);
}

export function validateTrack(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  reqStr(v, "id", r, path, true);
  reqStr(v, "name", r, path, true);
  const album = v.album;
  if (!isObj(album)) {
    r.errors.push(path + ".album: required object with id and name");
  } else {
    reqStr(album, "id", r, path + ".album", true);
    reqStr(album, "name", r, path + ".album", true);
    optStr(album, "imageUrl", r, path + ".album");
  }
  const artists = optArr(v, "artists", r, path);
  if (artists) each(artists, r, path + ".artists", validateArtist, "artist");
  if (v.duration !== undefined && v.duration !== null) {
    if (!isNum(v.duration) || v.duration < 0) r.errors.push(path + ".duration: must be milliseconds as a non-negative number");
  } else {
    r.warnings.push(path + ".duration: missing (milliseconds), the UI will show 0:00");
  }
  optStr(v, "url", r, path);
  optBool(v, "unavailable", r, path);
  optStr(v, "showId", r, path);
  optStr(v, "description", r, path);
  optStr(v, "published", r, path);
  if (v.source !== undefined) r.warnings.push(path + ".source: filled in by the app, the plugin should omit it");
  checkFields(v, ["id", "name", "artists", "album", "duration", "url", "unavailable", "showId", "description", "published", "source"], r, path);
}

export function validateTrackArray(v, r, path) {
  if (!isArr(v)) {
    r.errors.push(path + ": must be an array of tracks");
    return;
  }
  each(v, r, path, validateTrack, "track");
}

export function validatePlaylist(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  reqStr(v, "id", r, path, true);
  reqStr(v, "name", r, path, true);
  optStr(v, "imageUrl", r, path);
  optStr(v, "description", r, path);
  optStr(v, "owner", r, path);
  optNum(v, "trackCount", r, path);
  optBool(v, "mine", r, path);
  optBool(v, "saved", r, path);
  optBool(v, "fixed", r, path);
  const tracks = optArr(v, "tracks", r, path);
  if (tracks) each(tracks, r, path + ".tracks", validateTrack, "track");
  checkFields(v, ["id", "name", "imageUrl", "description", "owner", "trackCount", "mine", "saved", "fixed", "tracks"], r, path);
}

export function validatePlaylistArray(v, r, path) {
  if (!isArr(v)) {
    r.errors.push(path + ": must be an array of playlists");
    return;
  }
  each(v, r, path, validatePlaylist, "playlist");
}

export function validateAccount(v, r, path) {
  if (v === null || v === undefined) return;
  if (!isObj(v)) {
    r.errors.push(path + ": must be an account object or null");
    return;
  }
  reqStr(v, "id", r, path, true);
  reqStr(v, "name", r, path, true);
  optStr(v, "imageUrl", r, path);
  optStr(v, "page", r, path);
  checkFields(v, ["id", "name", "imageUrl", "page"], r, path);
}

export function validateSection(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  optStr(v, "title", r, path);
  optStr(v, "subtitle", r, path);
  optStr(v, "morePage", r, path);
  optStr(v, "empty", r, path);
  optStr(v, "pageTitle", r, path);
  const tracks = optArr(v, "tracks", r, path);
  if (tracks) each(tracks, r, path + ".tracks", validateTrack, "track");
  const albums = optArr(v, "albums", r, path);
  if (albums) each(albums, r, path + ".albums", validateAlbum, "album");
  const artists = optArr(v, "artists", r, path);
  if (artists) each(artists, r, path + ".artists", validateArtist, "artist");
  const playlists = optArr(v, "playlists", r, path);
  if (playlists) each(playlists, r, path + ".playlists", validatePlaylist, "playlist");
  const shows = optArr(v, "shows", r, path);
  if (shows) each(shows, r, path + ".shows", validateShow, "show");
  const stations = optArr(v, "stations", r, path);
  if (stations) each(stations, r, path + ".stations", validateStation, "station");
  const links = optArr(v, "links", r, path);
  if (links) each(links, r, path + ".links", validateLink, "link");
  const listCount = ["tracks", "albums", "artists", "playlists", "shows", "stations", "links"]
    .filter((key) => Array.isArray(v[key]) && v[key].length > 0).length;
  if (listCount === 0 && !v.title && !v.morePage) r.warnings.push(path + ": section has no content");
  checkFields(v, ["title", "subtitle", "morePage", "empty", "pageTitle", "tracks", "albums", "artists", "playlists", "shows", "stations", "links"], r, path);
}

export function validateLink(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  reqStr(v, "title", r, path, true);
  optStr(v, "subtitle", r, path);
  optStr(v, "imageUrl", r, path);
  reqStr(v, "page", r, path, true);
  checkFields(v, ["title", "subtitle", "imageUrl", "page"], r, path);
}

export function validateBrowse(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be a Browse object");
    return r;
  }
  optStr(v, "title", r, path);
  optStr(v, "subtitle", r, path);
  optStr(v, "imageUrl", r, path);
  optStr(v, "description", r, path);
  const sections = optArr(v, "sections", r, path);
  if (sections) each(sections, r, path + ".sections", validateSection, "section");
  if (!Array.isArray(v.sections) || v.sections.length === 0) {
    r.warnings.push(path + ".sections: empty or missing, the page will be blank");
  }
  checkFields(v, ["title", "subtitle", "imageUrl", "description", "sections"], r, path);
  return r;
}

export function validatePage(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be a Page object");
    return r;
  }
  const tracks = optArr(v, "tracks", r, path);
  if (tracks) each(tracks, r, path + ".tracks", validateTrack, "track");
  optBool(v, "more", r, path);
  checkFields(v, ["tracks", "more"], r, path);
  return r;
}

export function validateAlbumList(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be an AlbumList object");
    return r;
  }
  const albums = optArr(v, "albums", r, path);
  if (albums) each(albums, r, path + ".albums", validateAlbum, "album");
  optBool(v, "more", r, path);
  checkFields(v, ["albums", "more"], r, path);
  return r;
}

export function validateAlbumPage(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be an AlbumPage object");
    return r;
  }
  if (!isObj(v.album)) r.errors.push(path + ".album: required AlbumPage.album");
  else validateAlbum(v.album, r, path + ".album");
  const tracks = optArr(v, "tracks", r, path);
  if (tracks) each(tracks, r, path + ".tracks", validateTrack, "track");
  checkFields(v, ["album", "tracks"], r, path);
  return r;
}

export function validateArtistPage(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be an ArtistPage object");
    return r;
  }
  if (!isObj(v.artist)) r.errors.push(path + ".artist: required ArtistPage.artist");
  else validateArtist(v.artist, r, path + ".artist");
  const tracks = optArr(v, "tracks", r, path);
  if (tracks) each(tracks, r, path + ".tracks", validateTrack, "track");
  const albums = optArr(v, "albums", r, path);
  if (albums) each(albums, r, path + ".albums", validateAlbum, "album");
  checkFields(v, ["artist", "tracks", "albums"], r, path);
  return r;
}

export function validateShow(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  reqStr(v, "id", r, path, true);
  reqStr(v, "name", r, path, true);
  optStr(v, "imageUrl", r, path);
  optStr(v, "description", r, path);
  optStr(v, "publisher", r, path);
  optStr(v, "publisherPage", r, path);
  optNum(v, "episodeCount", r, path);
  optBool(v, "subscribed", r, path);
  checkFields(v, ["id", "name", "imageUrl", "description", "publisher", "publisherPage", "episodeCount", "subscribed"], r, path);
}

export function validateShowPage(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be a ShowPage object");
    return r;
  }
  if (!isObj(v.show)) r.errors.push(path + ".show: required ShowPage.show");
  else validateShow(v.show, r, path + ".show");
  const episodes = optArr(v, "episodes", r, path);
  if (episodes) each(episodes, r, path + ".episodes", validateTrack, "episode");
  optBool(v, "more", r, path);
  checkFields(v, ["show", "episodes", "more"], r, path);
  return r;
}

export function validateStation(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  reqStr(v, "id", r, path, true);
  reqStr(v, "name", r, path, true);
  optStr(v, "description", r, path);
  optStr(v, "imageUrl", r, path);
  checkFields(v, ["id", "name", "description", "imageUrl"], r, path);
}

export function validateComment(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  reqStr(v, "id", r, path, true);
  reqStr(v, "author", r, path, true);
  reqStr(v, "text", r, path, false);
  optStr(v, "avatarUrl", r, path);
  optNum(v, "time", r, path);
  optNum(v, "likes", r, path);
  optBool(v, "liked", r, path);
  checkFields(v, ["id", "author", "avatarUrl", "text", "time", "likes", "liked"], r, path);
}

export function validateCommentPage(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be a CommentPage object");
    return r;
  }
  const comments = optArr(v, "comments", r, path);
  if (comments) each(comments, r, path + ".comments", validateComment, "comment");
  optNum(v, "total", r, path);
  optBool(v, "more", r, path);
  checkFields(v, ["comments", "total", "more"], r, path);
  return r;
}

export function validateLyrics(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be a Lyrics object");
    return r;
  }
  optStr(v, "lrc", r, path);
  optStr(v, "translation", r, path);
  const lines = optArr(v, "lines", r, path);
  if (lines) each(lines, r, path + ".lines", validateLyricLine, "line");
  if (!v.lrc && (!Array.isArray(v.lines) || v.lines.length === 0)) r.warnings.push(path + ": has neither lrc nor lines");
  checkFields(v, ["lrc", "translation", "lines"], r, path);
  return r;
}

export function validateLyricLine(v, r, path) {
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object");
    return;
  }
  if (!isNum(v.start)) r.errors.push(path + ".start: required number (seconds)");
  optNum(v, "end", r, path);
  optStr(v, "text", r, path);
  optStr(v, "translation", r, path);
  const words = optArr(v, "words", r, path);
  if (words) each(words, r, path + ".words", (word, rr, pp) => {
    if (!isObj(word)) {
      rr.errors.push(pp + ": must be an object");
      return;
    }
    if (!isNum(word.start)) rr.errors.push(pp + ".start: required number");
    if (!isNum(word.end)) rr.errors.push(pp + ".end: required number");
    if (typeof word.text !== "string") rr.errors.push(pp + ".text: required string");
  }, "word");
  checkFields(v, ["start", "end", "text", "translation", "words"], r, path);
}

export function validateSearchResult(v, r, path, kind) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be a SearchResult object");
    return r;
  }
  const validators = {
    tracks: validateTrack,
    albums: validateAlbum,
    artists: validateArtist,
    playlists: validatePlaylist,
    shows: validateShow
  };
  for (const key of Object.keys(validators)) {
    const list = optArr(v, key, r, path);
    if (!list) continue;
    each(list, r, path + "." + key, validators[key], key);
  }
  optBool(v, "more", r, path);
  if (kind && (!Array.isArray(v[kind]) || v[kind].length === 0)) {
    r.warnings.push(path + "." + kind + ": empty for a kind=" + kind + " search (fine on no results)");
  }
  checkFields(v, ["tracks", "albums", "artists", "playlists", "shows", "more"], r, path);
  return r;
}

export function validateStream(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be a Stream object");
    return r;
  }
  reqStr(v, "url", r, path, true);
  if (typeof v.url === "string" && !/^(https?:|file:)/.test(v.url)) {
    r.errors.push(path + ".url: must start with http(s):// or file:// (got " + JSON.stringify(v.url.slice(0, 60)) + ")");
  }
  if (v.type === undefined || v.type === null) {
    r.warnings.push(path + ".type: missing; the cache will name the file .mp3");
  } else if (!STREAM_TYPES.includes(v.type)) {
    r.warnings.push(path + ".type: " + JSON.stringify(v.type) + " is not one of " + STREAM_TYPES.join("/"));
  }
  if (v.quality !== undefined && v.quality !== null && !QUALITIES.includes(v.quality)) {
    r.warnings.push(path + ".quality: " + JSON.stringify(v.quality) + " is not one of " + QUALITIES.join("/"));
  }
  if (v.size !== undefined && v.size !== null && (!isNum(v.size) || v.size <= 0)) {
    r.errors.push(path + ".size: must be a positive number of bytes when present (a wrong size defeats the cache)");
  }
  optNum(v, "bitRate", r, path);
  optNum(v, "peak", r, path);
  optNum(v, "gain", r, path);
  if (v.headers !== undefined && v.headers !== null) {
    if (!isObj(v.headers)) {
      r.errors.push(path + ".headers: must be an object of string headers");
    } else {
      for (const key of Object.keys(v.headers)) {
        if (typeof v.headers[key] !== "string") r.errors.push(path + ".headers." + key + ": header values must be strings");
      }
    }
  }
  checkFields(v, ["url", "type", "quality", "bitRate", "size", "peak", "gain", "headers"], r, path);
  return r;
}

export function validateRemoteState(v, r, path) {
  path = path || "result";
  if (v === null || v === undefined) return r;
  if (!isObj(v)) {
    r.errors.push(path + ": must be a RemoteState object or null");
    return r;
  }
  if (typeof v.playing !== "boolean") r.errors.push(path + ".playing: required boolean");
  optStr(v, "trackId", r, path);
  if (!isNum(v.position)) r.errors.push(path + ".position: required number of ms");
  if (!isNum(v.duration)) r.errors.push(path + ".duration: required number of ms");
  if (!isNum(v.volume)) r.errors.push(path + ".volume: required number 0-100");
  if (v.device !== undefined && v.device !== null) {
    if (!isObj(v.device)) r.errors.push(path + ".device: must be a Device object");
    else {
      reqStr(v.device, "id", r, path + ".device", true);
      reqStr(v.device, "name", r, path + ".device", true);
      optBool(v.device, "active", r, path + ".device");
    }
  }
  checkFields(v, ["playing", "trackId", "position", "duration", "volume", "device"], r, path);
  return r;
}

export function validateVoid(v, r, path) {
  if (v !== undefined && v !== null) r.warnings.push((path || "result") + ": expected no return value, got " + typeof v);
}

export function validateSuggest(v, r, path) {
  path = path || "result";
  if (!isArr(v)) {
    r.errors.push(path + ": must be an array of strings");
    return r;
  }
  v.forEach((item, i) => {
    if (typeof item !== "string") r.errors.push(path + "[" + i + "]: must be a string");
  });
}

export function validateIsLiked(v, r, path) {
  path = path || "result";
  if (!isObj(v)) {
    r.errors.push(path + ": must be an object mapping track id to boolean");
    return r;
  }
  for (const key of Object.keys(v)) {
    if (typeof v[key] !== "boolean") r.errors.push(path + "." + key + ": must be a boolean");
  }
}

export function validateStringArray(v, r, path) {
  validateSuggest(v, r, path);
}

function one(params) {
  return [{ label: null, params: params || (() => undefined) }];
}

function arrayValidator(inner, what) {
  return function (v, r, path) {
    path = path || "result";
    if (!isArr(v)) {
      r.errors.push(path + ": must be an array of " + what);
      return r;
    }
    each(v, r, path, inner, what);
    return r;
  };
}

export const EXPORTS = [
  { name: "signIn", calls: one(() => undefined), validate: validateAccount },
  { name: "signOut", calls: one(), validate: validateVoid },
  { name: "account", calls: one(), validate: (v, r) => validateAccount(v, r, "result") },
  { name: "search", calls: SEARCH_KINDS.map((kind) => ({ label: kind, params: () => ({ query: "周杰伦", kind: kind, offset: 0 }) })), validate: validateSearchResult, kindParam: true },
  { name: "suggest", calls: one(() => ({ query: "周" })), validate: validateSuggest },
  { name: "home", calls: one(), validate: validateBrowse },
  { name: "browse", calls: one(() => ({ page: "discover" })), validate: validateBrowse },
  { name: "playlists", calls: one(), validate: arrayValidator(validatePlaylist, "playlists") },
  { name: "playlist", calls: one(() => ({ id: "1" })), validate: validatePlaylist },
  { name: "album", calls: one(() => ({ id: "1" })), validate: validateAlbumPage },
  { name: "artist", calls: one(() => ({ id: "1" })), validate: validateArtistPage },
  { name: "liked", calls: one(() => ({ offset: 0 })), validate: validatePage },
  { name: "recent", calls: one(), validate: validateTrackArray },
  { name: "isLiked", calls: one(() => ({ ids: ["1", "2"] })), validate: validateIsLiked },
  { name: "like", calls: one(() => ({ id: "1", on: true })), validate: validateVoid },
  { name: "likeEpisode", calls: one(() => ({ id: "1", on: true })), validate: validateVoid },
  { name: "createPlaylist", calls: one(() => ({ name: "harness playlist" })), validate: validatePlaylist },
  { name: "renamePlaylist", calls: one(() => ({ id: "1", name: "renamed" })), validate: validateVoid },
  { name: "deletePlaylist", calls: one(() => ({ id: "1" })), validate: validateVoid },
  { name: "addToPlaylist", calls: one(() => ({ id: "1", trackIds: ["1"] })), validate: validateVoid },
  { name: "removeFromPlaylist", calls: one(() => ({ id: "1", trackIds: ["1"] })), validate: validateVoid },
  { name: "movePlaylistTrack", calls: one(() => ({ id: "1", from: 0, to: 1 })), validate: validateVoid },
  { name: "savePlaylist", calls: one(() => ({ id: "1", on: true })), validate: validateVoid },
  { name: "followArtist", calls: one(() => ({ id: "1", on: true })), validate: validateVoid },
  { name: "saveAlbum", calls: one(() => ({ id: "1", on: true })), validate: validateVoid },
  { name: "savedAlbums", calls: one(() => ({ offset: 0 })), validate: validateAlbumList },
  { name: "shows", calls: one(), validate: arrayValidator(validateShow, "shows") },
  { name: "show", calls: one(() => ({ id: "1", offset: 0 })), validate: validateShowPage },
  { name: "subscribeShow", calls: one(() => ({ id: "1", on: true })), validate: validateVoid },
  { name: "stations", calls: one(), validate: arrayValidator(validateStation, "stations") },
  { name: "stationNext", calls: one(() => ({ id: "1" })), validate: validateTrackArray },
  { name: "comments", calls: one(() => ({ trackId: "1", offset: 0 })), validate: validateCommentPage },
  { name: "likeComment", calls: one(() => ({ trackId: "1", commentId: "1", on: true })), validate: validateVoid },
  { name: "postComment", calls: one(() => ({ trackId: "1", text: "hello" })), validate: validateComment },
  { name: "played", calls: one(() => ({ id: "1" })), validate: validateVoid },
  { name: "lyrics", calls: one(() => ({ id: "1" })), validate: validateLyrics },
  { name: "stream", calls: one(() => ({ id: "1", quality: "high" })), validate: validateStream },
  { name: "remotePlay", calls: one(() => ({ ids: ["1"], start: 0, position: 0 })), validate: validateVoid },
  { name: "remotePause", calls: one(), validate: validateVoid },
  { name: "remoteResume", calls: one(), validate: validateVoid },
  { name: "remoteSeek", calls: one(() => ({ position: 0 })), validate: validateVoid },
  { name: "remoteVolume", calls: one(() => ({ percent: 50 })), validate: validateVoid },
  { name: "remoteState", calls: one(), validate: validateRemoteState },
  { name: "remoteDevices", calls: one(), validate: arrayValidator((v, r, p) => {
    if (!isObj(v)) {
      r.errors.push(p + ": must be a Device object");
      return;
    }
    reqStr(v, "id", r, p, true);
    reqStr(v, "name", r, p, true);
    optBool(v, "active", r, p);
  }, "devices") },
  { name: "remoteUse", calls: one(() => ({ deviceId: "d1" })), validate: validateVoid }
];

export function validateResult(spec, value, kind) {
  const r = result();
  const normalized = value === undefined ? null : value;
  checkSerializable(normalized, r, "result");
  spec.validate(normalized, r, "result", kind);
  return r;
}
