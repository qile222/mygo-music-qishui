#!/usr/bin/env python3
"""Rebuild assets/modes/ from the official Qishui Music scene-mode feed.

The official /luna/pc/feed/mode endpoint returns 400x400 transparent white icons
that are nearly invisible on MyGo's light cards. This script keeps the official
glyph and recolours it white, then places it on a per-mode color-gradient tile.
The tile colors are generated here, not taken from Qishui artwork: they are only
a display background inspired by the iTunes/Apple Music genre tiles. No glyph is
redrawn or substituted.

Usage:
    QISHUI_COOKIE='sessionid=...; ...' python3 tools/build-mode-assets.py
    python3 tools/build-mode-assets.py   # reads the local MyGo plugin session
    python3 tools/build-mode-assets.py --pill  # old neutral-pill preview

Requires Pillow. The cookie is only used for this request and never written to
the repository or manifest.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "modes"
UA = "LunaPC/3.0.0(290101097)"
FEED_URL = (
    "https://api.qishui.com/luna/pc/feed/mode"
    "?aid=386088&device_platform=pc&version_code=30020100"
)
STORAGE = Path.home() / "Library" / "Application Support" / "MyGo Music" / "plugin-data" / "qishui" / "storage.json"

# Curated deep gradients so the white official glyph always has contrast. Each
# scene gets its own pair; adjacent cards on the MyGo grid therefore differ.
PALETTES: dict[str, tuple[str, str]] = {
    "9": ("#0B1E2D", "#1F4E5F"),   # 抖音漫游
    "34": ("#1B4F72", "#2E86C1"),  # 摸鱼
    "33": ("#B45309", "#F59E0B"),  # 驾车
    "5": ("#D81B60", "#F06292"),   # 快乐时光
    "4": ("#2E1065", "#7C3AED"),   # 深夜 EMO
    "8": ("#0F172A", "#334155"),   # 助眠模式
    "7": ("#7E22CE", "#DB2777"),   # DJ模式
    "2": ("#C2410C", "#F97316"),   # 动感健身
    "3": ("#0F766E", "#2DD4BF"),   # Chill 放松
    "41": ("#075985", "#0EA5E9"),  # 洗澡
    "11": ("#4C1D95", "#8B5CF6"),  # 电音
    "45": ("#BE123C", "#FB7185"),  # 好运
    "48": ("#78350F", "#B45309"),  # 图书馆
    "10": ("#991B1B", "#EF4444"),  # 粤语
    "1": ("#065F46", "#10B981"),   # 通勤必听
    "13": ("#1E293B", "#64748B"),  # 失恋必听
    "44": ("#3F6212", "#84CC16"),  # 躺平
    "15": ("#312E81", "#6366F1"),  # 欧美
    "47": ("#0F766E", "#14B8A6"),  # 打扫
    "12": ("#7F1D1D", "#B91C1C"),  # 国风
    "37": ("#166534", "#22C55E"),  # 打游戏
    "6": ("#1E3A5F", "#3B82F6"),   # 专注模式
    "24": ("#9A3412", "#F97316"),  # 说唱
    "14": ("#1E40AF", "#60A5FA"),  # 沉浸0.8x
    "40": ("#111827", "#374151"),  # 夜晚
    "21": ("#6D28D9", "#EC4899"),  # 治愈
    "25": ("#475569", "#94A3B8"),  # 轻音乐
    "18": ("#78350F", "#D97706"),  # 小酒馆
    "31": ("#BE123C", "#F43F5E"),  # KTV必点
    "38": ("#B45309", "#FBBF24"),  # 起床
    "19": ("#9D174D", "#F472B6"),  # 浪漫情歌
    "28": ("#5B21B6", "#A855F7"),  # 摇滚
    "23": ("#9D174D", "#6366F1"),  # R&B
    "20": ("#4C1D95", "#7C3AED"),  # 佛系时间
    "16": ("#92400E", "#D97706"),  # 怀旧老歌
    "29": ("#14532D", "#4ADE80"),  # 民谣
    "17": ("#9D174D", "#F9A8D4"),  # 甜美女声
    "22": ("#831843", "#EC4899"),  # K-pop
    "30": ("#9A3412", "#FB923C"),  # 日语
    "36": ("#075985", "#38BDF8"),  # 旅行
    "26": ("#BE185D", "#F9A8D4"),  # 儿歌
    "35": ("#1E3A8A", "#60A5FA"),  # 雨天
    "39": ("#0C4A6E", "#0EA5E9"),  # 海边
    "27": ("#78350F", "#CA8A04"),  # 乡村
    "32": ("#78350F", "#A16207"),  # 古典
}


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


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def palette_for(scene_id: str) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    pair = PALETTES.get(scene_id)
    if pair:
        return hex_rgb(pair[0]), hex_rgb(pair[1])
    # Deterministic fallback for a mode added by Qishui before this map is updated.
    try:
        seed = int(scene_id)
    except ValueError:
        seed = sum(ord(ch) for ch in scene_id)
    hue = (seed * 47) % 360
    import colorsys

    top = colorsys.hls_to_rgb(hue / 360.0, 0.42, 0.62)
    bottom = colorsys.hls_to_rgb(((hue + 26) % 360) / 360.0, 0.30, 0.58)
    return tuple(int(v * 255) for v in top), tuple(int(v * 255) for v in bottom)  # type: ignore[return-value]


def make_tile(glyph: Image.Image, scene_id: str, size: int = 400) -> Image.Image:
    bbox = glyph.getchannel("A").getbbox()
    if bbox:
        glyph = glyph.crop(bbox)
    glyph.thumbnail((132, 132), Image.LANCZOS)
    glyph = recolor(glyph, (255, 255, 255))
    top, bottom = palette_for(scene_id)
    # Diagonal gradient: top-left lighter, bottom-right deeper.
    canvas = Image.new("RGB", (size, size), top)
    px = canvas.load()
    denom = (size - 1) * 2
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            px[x, y] = (
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
            )
    canvas = canvas.convert("RGBA")
    # Soft top-left highlight, inspired by the lighting on iTunes genre tiles.
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-size * 0.32, -size * 0.55, size * 0.82, size * 0.55], fill=(255, 255, 255, 22))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.10))
    canvas = Image.alpha_composite(canvas, glow)
    # A very soft shadow keeps the white glyph readable on the brighter palettes.
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = glyph.getchannel("A")
    shadow.paste((0, 0, 0, 62), ((size - glyph.width) // 2 + 2, (size - glyph.height) // 2 + 8), mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(5))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))
    return canvas


def make_pill(glyph: Image.Image, size: int = 400) -> Image.Image:
    bbox = glyph.getchannel("A").getbbox()
    if bbox:
        glyph = glyph.crop(bbox)
    glyph.thumbnail((100, 100), Image.LANCZOS)
    glyph = recolor(glyph, (255, 255, 255))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
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
    pill_preview = "--pill" in sys.argv[1:]
    modes = {}
    for scene_id, name, url in scene_modes(payload):
        if not url:
            print(f"skip {scene_id} {name}: no icon url", file=sys.stderr)
            continue
        raw = fetch_bytes(url, cookie)
        glyph = Image.open(BytesIO(raw)).convert("RGBA")
        if pill_preview:
            make_pill(glyph).save(OUT_DIR / f"{scene_id}.webp", "WEBP", quality=92)
        else:
            make_tile(glyph, scene_id).save(OUT_DIR / f"{scene_id}.webp", "WEBP", quality=92)
        modes[scene_id] = name
    manifest = {
        "source": "https://api.qishui.com/luna/pc/feed/mode (official scene-mode url_info icons)",
        "style": "Official Qishui glyph recoloured white and centered on a per-mode iTunes-style color-gradient tile; no redrawn or substituted artwork.",
        "size": 400,
        "modes": modes,
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(modes)} mode tiles to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
