#!/usr/bin/env python3
"""Rebuild assets/modes/ from the official Qishui Music scene-mode feed.

The official /luna/pc/feed/mode endpoint returns 400x400 transparent white icons
that are nearly invisible on MyGo's light cards. This script keeps the official
glyph, recolours it white and places it on a short neutral dark pill so the same
asset works in both light and dark themes. No artwork is redrawn or substituted.

Usage:
    QISHUI_COOKIE='sessionid=...; ...' python3 tools/build-mode-assets.py
    python3 tools/build-mode-assets.py   # reads the local MyGo plugin session

Requires Pillow. The cookie is only used for this request and never written to
the repository or manifest.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "modes"
UA = "LunaPC/3.0.0(290101097)"
FEED_URL = (
    "https://api.qishui.com/luna/pc/feed/mode"
    "?aid=386088&device_platform=pc&version_code=30020100"
)
STORAGE = Path.home() / "Library" / "Application Support" / "MyGo Music" / "plugin-data" / "qishui" / "storage.json"


def read_cookie() -> str:
    cookie = os.environ.get("QISHUI_COOKIE", "").strip()
    if cookie:
        return cookie
    try:
        data = json.loads(STORAGE.read_text())
    except Exception:
        return ""
    raw = data.get("cookie")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    cookies = ((data.get("session") or {}).get("cookies") or {})
    if isinstance(cookies, dict) and cookies:
        return "; ".join(f"{k}={v}" for k, v in cookies.items())
    return ""


def request_json(url: str, cookie: str):
    req = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "User-Agent": UA,
            "Content-Type": "application/json",
            "Cookie": cookie,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_bytes(url: str, cookie: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Cookie": cookie},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def icon_url(url_info) -> str:
    """Build the same CDN URL shape the plugin uses for covers.

    url_info.urls[0] is only the base (for example https://p3-luna.douyinpic.com/img/);
    the real object lives at urls[0] + uri + "~" + template_prefix + "-resize:400:400.webp".
    """
    if not isinstance(url_info, dict):
        return ""
    urls = url_info.get("urls")
    base = str(urls[0] or "") if isinstance(urls, list) and urls else ""
    uri = str(url_info.get("uri") or "").strip()
    template = str(url_info.get("template_prefix") or "").strip()
    if base and uri:
        if not base.endswith("/"):
            base += "/"
        url = base + uri.lstrip("/")
        if template:
            url += "~" + template + "-resize:400:400.webp"
        return url
    return uri or base


def scene_modes(payload: dict):
    seen = set()
    for block in payload.get("feed_mode_block") or []:
        for entry in block.get("feed_mode") or []:
            scene = ((entry or {}).get("entity") or {}).get("feed_scene_mode") or {}
            scene_id = scene.get("scene_mode_id")
            if scene_id is None:
                continue
            scene_id = str(scene_id).strip()
            if not scene_id or scene_id in seen:
                continue
            seen.add(scene_id)
            name = str(entry.get("text") or "").strip() or f"scene-{scene_id}"
            yield scene_id, name, icon_url(entry.get("url_info"))


def recolor(im: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    out = Image.new("RGBA", im.size, color + (0,))
    out.putalpha(im.getchannel("A"))
    return out


def make_pill(glyph: Image.Image, size: int = 400) -> Image.Image:
    bbox = glyph.getchannel("A").getbbox()
    if bbox:
        glyph = glyph.crop(bbox)
    glyph.thumbnail((100, 100), Image.LANCZOS)
    glyph = recolor(glyph, (255, 255, 255))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    # Keep the visible shape short and wide: MyGo renders station art in a square
    # card, so a pill is the closest possible match to Qishui's compact mode cards.
    draw.rounded_rectangle([40, 130, 360, 270], radius=70, fill=(45, 49, 59, 255))
    canvas.alpha_composite(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))
    return canvas


def main() -> int:
    cookie = read_cookie()
    payload = request_json(FEED_URL, cookie)
    if payload.get("status_info", {}).get("status_code") not in (0, None):
        print("feed/mode returned an unexpected status; check the cookie", file=sys.stderr)
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    modes = {}
    for scene_id, name, url in scene_modes(payload):
        if not url:
            print(f"skip {scene_id} {name}: no icon url", file=sys.stderr)
            continue
        raw = fetch_bytes(url, cookie)
        from io import BytesIO

        glyph = Image.open(BytesIO(raw)).convert("RGBA")
        make_pill(glyph).save(OUT_DIR / f"{scene_id}.webp", "WEBP", quality=92)
        modes[scene_id] = name
    manifest = {
        "source": "https://api.qishui.com/luna/pc/feed/mode (official scene-mode url_info icons)",
        "style": "Official Qishui glyph recoloured white and centered on a short neutral dark pill for light/dark MyGo cards; no redrawn or substituted artwork.",
        "size": 400,
        "modes": modes,
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(modes)} mode pills to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
