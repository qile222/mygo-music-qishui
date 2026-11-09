#!/usr/bin/env python3
"""汽水音乐 API 只读探针（stdlib only）。

用途：对照 fixtures/ 与 docs/API.md 复核接口是否仍然可用；输出自动脱敏。
绝不打印 Cookie、签名 URL、账号昵称/uid；不做任何写操作。

用法:
  python3 tools/probe-qishui.py home
  python3 tools/probe-qishui.py search 薛之谦
  python3 tools/probe-qishui.py play 6778775242320906241
  python3 tools/probe-qishui.py playlist 7031081053599074335 --cookie
  python3 tools/probe-qishui.py liked
  python3 tools/probe-qishui.py history --count 50
  python3 tools/probe-qishui.py comments 6778775242320906241
  python3 tools/probe-qishui.py album 6778775240618018818
  python3 tools/probe-qishui.py artist 6807264292040083458
  python3 tools/probe-qishui.py radio
  python3 tools/probe-qishui.py all

Cookie 来源（按优先级）:
  1. --storage <path>   MyGo storage.json（取其中的 cookie 字段）
  2. QISHUI_COOKIE 环境变量
  3. 默认 macOS 路径: ~/Library/Application Support/MyGo Music/plugin-data/qishui/storage.json

选项:
  --json      输出机器可读 JSON（同样已脱敏）
  --cookie    对 playlist 命令强制携带 Cookie（带 Cookie 时必须同时带 aid）
  --count N   history 每页条数（10/30/50/100/200）
"""

import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

APP = "https://beta-luna.douyin.com"
PC = "https://api.qishui.com"
APP_UA = "Luna/19.1.0 Android"
PC_UA = "LunaPC/3.0.0(290101097)"
WEB_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
def _random_iid():
    """iid 只是匿名请求的客户端标识，每次运行随机生成，避免携带固定设备标识。"""
    return "".join([str(random.randint(1, 9))] +
                   [str(random.randint(0, 9)) for _ in range(14)])


APPQ = {"aid": "386088", "device_platform": "android",
        "version_code": "30020100", "iid": _random_iid()}
DEFAULT_STORAGE = os.path.expanduser(
    "~/Library/Application Support/MyGo Music/plugin-data/qishui/storage.json")
SIGNED_HINTS = ("douyinvod", "vod-luna", "X-Amz", "GetPlayInfo", "v5-luna", "vod-")
TIMEOUT = 15


# ---------- 脱敏 ----------

def redact(value):
    """把签名 URL / 超长串替换成占位符，避免打印凭据。"""
    if isinstance(value, str):
        if "http" in value and any(h in value for h in SIGNED_HINTS):
            return "<signed-url>"
        if len(value) > 120:
            return value[:117] + "..."
        return value
    return value


def summarize(obj, depth=0, max_depth=3):
    """把响应压成结构摘要：keys / 长度 / 标量值（脱敏）。"""
    if depth > max_depth:
        return "..."
    if isinstance(obj, dict):
        out = {}
        for k, v in list(obj.items())[:40]:
            if k in ("log_id",):
                continue
            if isinstance(v, (dict, list)):
                out[k] = summarize(v, depth + 1, max_depth)
            else:
                out[k] = redact(v)
        return out
    if isinstance(obj, list):
        if not obj:
            return []
        return [summarize(obj[0], depth + 1, max_depth), "len=" + str(len(obj))]
    return redact(obj)


# ---------- HTTP ----------

def get_cookie(storage, override):
    if override:
        return override
    env = os.environ.get("QISHUI_COOKIE")
    if env:
        return env.strip()
    try:
        with open(storage, "r", encoding="utf-8") as f:
            data = json.load(f)
        cookie = data.get("cookie") or ""
        if isinstance(cookie, dict):
            cookie = "; ".join(str(k) + "=" + str(v) for k, v in cookie.items())
        return cookie.strip()
    except Exception:
        return ""


def request(method, url, body=None, ua=PC_UA, cookie=""):
    data = None
    headers = {"User-Agent": ua, "Accept": "application/json, text/plain, */*"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            status = resp.status
            ctype = resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
        ctype = e.headers.get("Content-Type", "")
    except Exception as e:  # 网络错误
        return {"status": 0, "ms": int((time.time() - t0) * 1000),
                "error": type(e).__name__ + ": " + str(e)[:120], "json": None}
    ms = int((time.time() - t0) * 1000)
    try:
        js = json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        js = None
    return {"status": status, "ms": ms, "ctype": ctype,
            "json": js, "bytes": len(raw),
            "text_head": None if js is not None else raw[:80].decode("utf-8", "replace")}


def qs(base, params):
    return base + "?" + urllib.parse.urlencode(params)


def app_url(path, extra=None):
    params = dict(APPQ)
    if extra:
        params.update(extra)
    return qs(APP + path, params)


def pc_url(path, extra=None):
    if not extra:
        return PC + path
    return qs(PC + path, extra)


def describe(res, label):
    out = {"label": label, "http": res.get("status"), "ms": res.get("ms"),
           "bytes": res.get("bytes")}
    js = res.get("json")
    if js is None:
        out["error"] = res.get("error") or ("non-json: " + str(res.get("text_head")))
        return out
    out["status_code"] = js.get("status_code")
    si = js.get("status_info") or {}
    if js.get("status_code") not in (None, 0):
        out["status_msg"] = si.get("status_msg")
    out["keys"] = [k for k in js.keys() if k not in ("status_info", "status_code")]
    return out


def ok(res):
    js = res.get("json") or {}
    return res.get("status") == 200 and js.get("status_code") in (None, 0)


# ---------- 命令 ----------

def cmd_home(cfg):
    res = request("POST", app_url("/luna/discover"), body={}, ua=APP_UA)
    d = describe(res, "APP POST /luna/discover")
    js = res.get("json") or {}
    blocks = []
    for b in js.get("blocks") or []:
        item = {"type": b.get("type"), "title": b.get("title"),
                "inner_count": len(b.get("inner_block") or [])}
        if b.get("type") == "discover_top_song_list":
            charts = []
            for ib in b.get("inner_block") or []:
                charts.append({"title": ib.get("title"), "id": ib.get("inner_block_id"),
                               "desc": (ib.get("desc") or "")[:40],
                               "tracks": len(ib.get("resources") or [])})
            item["charts"] = charts
        else:
            item["sample_playlists"] = [
                (r.get("entity") or {}).get("playlist", {}).get("title")
                for ib in (b.get("inner_block") or [])[:3]
                for r in (ib.get("resources") or [])[:1]]
        blocks.append(item)
    d["blocks"] = blocks
    return d


SEARCH_TABS = ["track", "album", "artist", "playlist"]


def cmd_search(cfg, q):
    results = []
    started = time.time()
    for tab in SEARCH_TABS:
        res = request("GET", pc_url("/luna/pc/search/" + tab, {"q": q, "cursor": "0"}))
        d = describe(res, "GET /luna/pc/search/" + tab)
        js = res.get("json") or {}
        groups = js.get("result_groups") or []
        if groups:
            g = groups[0]
            data = g.get("data") or []
            d["group"] = {"id": g.get("id"), "has_more": g.get("has_more"),
                          "next_cursor": g.get("next_cursor"), "items": len(data)}
            ents = []
            for item in data[:3]:
                ent = item.get("entity") or {}
                key = next(iter(ent.keys()), None)
                val = ent.get(key) or {}
                if isinstance(val, dict) and "track_wrapper" in val:
                    val = val.get("track_wrapper") or {}
                    val = val.get("track") or {}
                ents.append({"key": key, "name": val.get("name") or val.get("title")})
            d["group"]["sample"] = ents
        results.append(d)
    return {"query": q, "http": results[0].get("http") if results else None,
            "ms": int((time.time() - started) * 1000), "tabs": results}


def cmd_play(cfg, track_id):
    res = request("GET", app_url("/luna/h5/seo_track",
                                 {"track_id": track_id, "device_platform": "web"}),
                  ua=WEB_UA, cookie=cfg["cookie"] if cfg["use_cookie"] else "")
    d = describe(res, "GET /luna/h5/seo_track")
    js = res.get("json") or {}
    seo = js.get("seo_track") or {}
    track = seo.get("track") or {}
    d["track"] = {"name": track.get("name"), "duration_ms": track.get("duration"),
                  "only_vip_playable": (track.get("label_info") or {}).get("only_vip_playable")}
    lyric = js.get("lyric") or {}
    d["lyric"] = {"present": bool(lyric.get("content")),
                  "type": lyric.get("type"), "lang": lyric.get("lang"),
                  "content_len": len(lyric.get("content") or "")}
    tp = js.get("track_player")
    if not tp or not tp.get("video_model"):
        d["playable"] = False
        d["reason"] = "no track_player"
        return d
    try:
        vm = json.loads(tp.get("video_model"))
    except Exception:
        d["playable"] = True
        d["note"] = "video_model parse failed"
        return d
    vd = float(vm.get("video_duration") or 0)
    full = track.get("duration") and vd and (vd * 1000 + 1500 >= track["duration"])
    d["playable"] = True
    d["video_duration_s"] = vd
    d["full_track"] = bool(full)
    d["url_count"] = len(vm.get("video_list") or [])
    d["qualities"] = [((v.get("video_meta") or {}).get("quality"),
                       (v.get("video_meta") or {}).get("bitrate"))
                      for v in (vm.get("video_list") or [])]
    d["url_expire"] = vm.get("url_expire")
    return d


def cmd_playlist(cfg, playlist_id):
    use_cookie = cfg["use_cookie"]
    params = {"playlist_id": playlist_id, "cursor": ""}
    if use_cookie:
        params["aid"] = "386088"
    res = request("GET", pc_url("/luna/pc/playlist/detail", params),
                  cookie=cfg["cookie"] if use_cookie else "")
    d = describe(res, "GET /luna/pc/playlist/detail")
    js = res.get("json") or {}
    pl = js.get("playlist") or {}
    media = js.get("media_resources") or []
    d["playlist"] = {"title": pl.get("title"), "type": pl.get("type"),
                     "is_private": pl.get("is_private"),
                     "count_tracks": pl.get("count_tracks"),
                     "count_visible": (pl.get("stats") or {}).get("count_visible"),
                     "resource_track_cnt": (pl.get("resource_cnt") or {}).get("track_cnt")}
    d["media"] = {"count": len(media), "has_more": js.get("has_more"),
                  "next_cursor": js.get("next_cursor"),
                  "tracks": [(m.get("entity") or {}).get("track_wrapper", {})
                             .get("track", {}).get("name") for m in media[:3]]}
    return d


def cmd_liked(cfg):
    out = {"cookie_present": bool(cfg["cookie"]), "http": None}
    if not cfg["cookie"]:
        out["error"] = "no cookie: 私有接口不可用（1000016）"
        return out
    res = request("GET", pc_url("/luna/pc/me", {"aid": "386088"}), cookie=cfg["cookie"])
    d = describe(res, "GET /luna/pc/me")
    js = res.get("json") or {}
    out["http"] = res.get("status")
    out["me"] = {"ok": ok(res), "logged_in": bool((js.get("my_info") or {}).get("id")),
                 "status_code": js.get("status_code")}
    res2 = request("GET", pc_url("/luna/pc/me/playlist",
                                 {"aid": "386088", "cursor": "", "count": "50"}),
                   cookie=cfg["cookie"])
    js2 = res2.get("json") or {}
    pls = js2.get("playlists") or []
    out["playlists"] = {"http": res2.get("status"), "count": len(pls),
                        "items": [{"title": p.get("title"), "type": p.get("type"),
                                   "is_private": p.get("is_private"),
                                   "count_tracks": p.get("count_tracks")} for p in pls]}
    liked = next((p for p in pls if p.get("type") == 1), None)
    if liked:
        out["liked_detail"] = cmd_playlist(cfg, liked.get("id"))
    return out


def cmd_history(cfg, count):
    if not cfg["cookie"]:
        return {"error": "no cookie: 无法读取历史（1000016）"}
    res = request("GET", pc_url("/luna/pc/me/recently-played-media",
                                {"aid": "386088", "cursor": "", "count": str(count)}),
                  cookie=cfg["cookie"])
    d = describe(res, "GET /luna/pc/me/recently-played-media")
    js = res.get("json") or {}
    media = js.get("media") or []
    d["media"] = {"count": len(media), "total_num": js.get("total_num"),
                  "has_more": js.get("has_more"), "next_cursor": js.get("next_cursor"),
                  "tracks": [((m.get("entity") or {}).get("track") or {}).get("name")
                             for m in media[:3]]}
    return d


def cmd_comments(cfg, track_id):
    res = request("GET", app_url("/luna/comments",
                                 {"group_id": track_id, "group_type": "0", "cursor": "",
                                  "count": "20", "image_strategy": "2"}),
                  ua=APP_UA, cookie=cfg["cookie"])
    d = describe(res, "GET /luna/comments")
    js = res.get("json") or {}
    cs = js.get("comments") or []
    d["comments"] = {"count": js.get("count"), "has_more": js.get("has_more"),
                     "cursor": js.get("cursor"), "items": len(cs),
                     "first": ({"content_len": len(cs[0].get("content") or ""),
                                "count_digged": cs[0].get("count_digged")} if cs else None)}
    return d


def cmd_album(cfg, album_id):
    res = request("GET", pc_url("/luna/pc/albums/" + urllib.parse.quote(album_id)))
    d = describe(res, "GET /luna/pc/albums/{id}")
    js = res.get("json") or {}
    ai = js.get("album_info") or {}
    tracks = js.get("tracks") or []
    d["album"] = {"name": ai.get("name"), "count_tracks": ai.get("count_tracks"),
                  "release_date": ai.get("release_date"),
                  "artists": [a.get("name") for a in (ai.get("artists") or [])],
                  "tracks": len(tracks),
                  "samples": [t.get("name") for t in tracks[:3]]}
    return d


def cmd_artist(cfg, artist_id):
    out = {}
    res = request("GET", pc_url("/luna/pc/artists/" + urllib.parse.quote(artist_id)))
    out["http"] = res.get("status")
    out["ms"] = res.get("ms")
    d = describe(res, "GET /luna/pc/artists/{id}")
    ai = (res.get("json") or {}).get("artist_info") or {}
    d["artist"] = {"name": ai.get("name"), "count_albums": ai.get("count_albums"),
                   "count_tracks": ai.get("count_tracks")}
    out["detail"] = d
    res2 = request("GET", pc_url("/luna/pc/artists/" + urllib.parse.quote(artist_id) + "/tracks",
                                 {"cursor": "0"}))
    js2 = res2.get("json") or {}
    d2 = describe(res2, "GET /luna/pc/artists/{id}/tracks")
    d2["page"] = {"count": len(js2.get("tracks") or []),
                  "has_more": js2.get("has_more"), "next_cursor": js2.get("next_cursor")}
    out["tracks"] = d2
    res3 = request("GET", pc_url("/luna/pc/artists/" + urllib.parse.quote(artist_id) + "/albums",
                                 {"cursor": "0"}))
    js3 = res3.get("json") or {}
    d3 = describe(res3, "GET /luna/pc/artists/{id}/albums")
    d3["page"] = {"count": len(js3.get("albums") or []),
                  "has_more": js3.get("has_more"), "next_cursor": js3.get("next_cursor")}
    out["albums"] = d3
    return out


def cmd_radio(cfg):
    body = {"first_request": True, "pc_new_discover_request": True}
    res = request("POST", pc_url("/luna/pc/discover"), body=body)
    d = describe(res, "POST /luna/pc/discover")
    js = res.get("json") or {}
    radios = []
    for b in js.get("blocks") or []:
        for ib in b.get("inner_block") or []:
            for r in (ib.get("resources") or [])[:1]:
                if r.get("type") == "radio":
                    style = r.get("style") or {}
                    radios.append({"id": r.get("resource_id"), "title": style.get("title"),
                                   "type": r.get("type")})
    d["radios"] = {"count": len(radios), "items": radios[:5]}
    if radios:
        res2 = request("POST", pc_url("/luna/pc/feed/radio/tracks"),
                       body={"radio_id": radios[0]["id"], "count": 6, "cursor": ""})
        js2 = res2.get("json") or {}
        d2 = describe(res2, "POST /luna/pc/feed/radio/tracks")
        d2["items"] = {"count": len(js2.get("items") or []),
                       "has_more": js2.get("has_more"),
                       "tracks": [((it.get("entity") or {}).get("track_wrapper") or {})
                                  .get("track", {}).get("name")
                                  for it in (js2.get("items") or [])[:3]]}
        d["tracks"] = d2
    return d


# ---------- 入口 ----------

def main(argv):
    args = argv[1:]
    opts = {"json": False, "cookie": False, "count": 30, "storage": DEFAULT_STORAGE}
    positional = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--json":
            opts["json"] = True
        elif a == "--cookie":
            opts["cookie"] = True
        elif a == "--count" and i + 1 < len(args):
            i += 1
            try:
                opts["count"] = int(args[i])
            except ValueError:
                pass
        elif a == "--storage" and i + 1 < len(args):
            i += 1
            opts["storage"] = os.path.expanduser(args[i])
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            positional.append(a)
        i += 1
    if not positional:
        print(__doc__)
        return 2
    cmd, rest = positional[0], positional[1:]
    cookie = get_cookie(opts["storage"], None)
    cfg = {"cookie": cookie,
           "use_cookie": bool(cookie) and (opts["cookie"] or cmd in ("liked", "history"))}
    dispatch = {
        "home": lambda: cmd_home(cfg),
        "search": lambda: cmd_search(cfg, rest[0] if rest else "薛之谦"),
        "play": lambda: cmd_play(cfg, rest[0] if rest else "6778775242320906241"),
        "playlist": lambda: cmd_playlist(cfg, rest[0] if rest else "7031081053599074335"),
        "liked": lambda: cmd_liked(cfg),
        "history": lambda: cmd_history(cfg, opts["count"]),
        "comments": lambda: cmd_comments(cfg, rest[0] if rest else "6778775242320906241"),
        "album": lambda: cmd_album(cfg, rest[0] if rest else "6778775240618018818"),
        "artist": lambda: cmd_artist(cfg, rest[0] if rest else "6807264292040083458"),
        "radio": lambda: cmd_radio(cfg),
    }
    if cmd in ("all", "selfcheck"):
        report = {"cookie_present": bool(cookie), "checks": []}
        plan = [("home", lambda: cmd_home(cfg)),
                ("search", lambda: cmd_search(cfg, "薛之谦")),
                ("play", lambda: cmd_play(cfg, "6778775242320906241")),
                ("album", lambda: cmd_album(cfg, "6778775240618018818")),
                ("artist", lambda: cmd_artist(cfg, "6807264292040083458")),
                ("comments", lambda: cmd_comments(cfg, "6778775242320906241")),
                ("radio", lambda: cmd_radio(cfg)),
                ("playlist_anon", lambda: cmd_playlist(
                    {"cookie": cookie, "use_cookie": False}, "7031081053599074335"))]
        if cookie:
            plan += [("liked", lambda: cmd_liked(cfg)),
                     ("history", lambda: cmd_history(cfg, opts["count"]))]
        for name, fn in plan:
            try:
                r = fn()
                report["checks"].append({"name": name, "http": r.get("http"),
                                         "ok": r.get("status_code") in (None, 0),
                                         "ms": r.get("ms")})
            except Exception as e:
                report["checks"].append({"name": name, "ok": False,
                                         "error": type(e).__name__ + ": " + str(e)[:100]})
        if opts["json"]:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            print("cookie: " + ("present" if cookie else "absent"))
            for c in report["checks"]:
                print("%-14s http=%-4s ok=%-5s %sms" % (c["name"], c.get("http"),
                                                       c.get("ok"), c.get("ms")))
        return 0
    if cmd not in dispatch:
        print("unknown command: " + cmd)
        print(__doc__)
        return 2
    result = dispatch[cmd]()
    if opts["json"]:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
