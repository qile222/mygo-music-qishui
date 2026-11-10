#!/usr/bin/env python3
"""Generate the listening-mode artwork that ships in assets/modes/.

Qishui's scene-mode API only returns transparent white line icons, not photo
covers. Shipping those official icons would mean redistributing Qishui assets,
so this repo uses semantically matching Lucide icons instead (ISC licence).
Each 400x400 WebP is a dark gradient tile with one white Lucide icon.

Requires:
  - Python 3 with Pillow (the DSH runtime Python works)
  - rsvg-convert (brew install librsvg)

Usage:
  python3 tools/build-mode-assets.py
  python3 tools/build-mode-assets.py --only 33,car
"""

import argparse
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "modes"
LUCIDE_VERSION = "1.70.0"
LUCIDE_CDN = "https://cdn.jsdelivr.net/npm/lucide-static@" + LUCIDE_VERSION + "/icons/"
LICENSE_URL = "https://cdn.jsdelivr.net/npm/lucide-static@" + LUCIDE_VERSION + "/LICENSE"
SIZE = 400
ICON_SIZE = 200
TILE_TOP = (30, 36, 48)
TILE_BOTTOM = (12, 15, 21)

# asset key -> Lucide icon name. Keep this mapping stable: index.js derives the
# file name from the Qishui mode id (scene ids, "familiar"/"fresh") and never
# needs to know the Lucide name.
MODES = {
    "recommendations": ("radio", "私人漫游 / Private Radio"),
    "familiar": ("repeat-2", "熟悉模式 / Familiar"),
    "fresh": ("sparkles", "新鲜模式 / Fresh"),
    "9": ("smartphone", "抖音漫游 / Douyin Viral"),
    "34": ("fish", "摸鱼 / Slacking Off"),
    "33": ("car", "驾车 / Driving"),
    "5": ("smile", "快乐时光 / Happy Hour"),
    "4": ("moon-star", "深夜 EMO"),
    "8": ("bed", "助眠模式"),
    "7": ("disc-3", "DJ 模式"),
    "2": ("dumbbell", "动感健身"),
    "3": ("leaf", "Chill 放松 / Chill"),
    "41": ("droplets", "洗澡"),
    "11": ("zap", "电音"),
    "45": ("clover", "好运"),
    "48": ("book-open", "图书馆"),
    "10": ("captions", "粤语"),
    "1": ("train-front", "通勤必听"),
    "13": ("heart-crack", "失恋必听"),
    "44": ("sofa", "躺平"),
    "15": ("globe", "欧美"),
    "47": ("brush-cleaning", "打扫"),
    "12": ("scroll-text", "国风"),
    "37": ("gamepad-2", "游戏"),
    "6": ("target", "专注模式 / Focus"),
    "24": ("mic-2", "说唱 / Rap"),
    "14": ("audio-waveform", "沉浸 0.8x"),
    "40": ("moon", "晚安"),
    "21": ("heart-pulse", "心动"),
    "25": ("music-2", "轻音乐"),
    "18": ("wine", "小酌"),
    "31": ("mic-vocal", "KTV"),
    "38": ("sunrise", "早起"),
    "19": ("heart", "甜蜜"),
    "28": ("drum", "摇滚"),
    "23": ("audio-lines", "R&B"),
    "20": ("flower-2", "佛系"),
    "16": ("cassette-tape", "怀旧"),
    "29": ("guitar", "民谣"),
    "17": ("mic", "甜美女声"),
    "22": ("star", "K-pop"),
    "30": ("languages", "日语"),
    "36": ("plane", "旅行"),
    "26": ("baby", "儿歌"),
    "35": ("cloud-rain", "雨天"),
    "39": ("waves", "海边"),
    "27": ("trees", "森林"),
    "32": ("piano", "钢琴"),
}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "mygo-qishui-mode-assets"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def gradient_background() -> Image.Image:
    image = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(image)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        colour = tuple(int(TILE_TOP[i] * (1 - t) + TILE_BOTTOM[i] * t) for i in range(3))
        draw.line([(0, y), (SIZE, y)], fill=colour)

    # Soft light from the top-left, like the studio backdrop on Qishui's cards.
    glow = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(glow).ellipse((-140, -160, 300, 280), fill=22)
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    return Image.composite(Image.new("RGB", (SIZE, SIZE), (255, 255, 255)), image, glow)


def render_icon(icon_name: str, work_dir: Path) -> Image.Image:
    svg = fetch(LUCIDE_CDN + icon_name + ".svg").decode("utf-8")
    svg = svg.replace("currentColor", "#FFFFFF").replace('stroke-width="2"', 'stroke-width="1.8"')
    svg_path = work_dir / (icon_name + ".svg")
    png_path = work_dir / (icon_name + ".png")
    svg_path.write_text(svg, encoding="utf-8")
    subprocess.run(
        [
            "rsvg-convert",
            "-w",
            str(ICON_SIZE),
            "-h",
            str(ICON_SIZE),
            "-o",
            str(png_path),
            str(svg_path),
        ],
        check=True,
        capture_output=True,
    )
    return Image.open(png_path).convert("RGBA")


def build_one(asset_key: str, icon_name: str, tile: Image.Image, work_dir: Path, overwrite: bool) -> Path:
    destination = OUT_DIR / (asset_key + ".webp")
    if destination.exists() and not overwrite:
        return destination
    icon = render_icon(icon_name, work_dir)
    canvas = tile.copy().convert("RGBA")
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    layer.paste(icon, ((SIZE - ICON_SIZE) // 2, (SIZE - ICON_SIZE) // 2), icon)
    canvas = Image.alpha_composite(canvas, layer)
    canvas.convert("RGB").save(destination, "WEBP", quality=88, method=6)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="comma-separated asset keys (e.g. 33,car)")
    parser.add_argument("--force", action="store_true", help="rebuild tiles that already exist")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    keys = list(MODES)
    if args.only:
        keys = [key.strip() for key in args.only.split(",") if key.strip()]
        unknown = [key for key in keys if key not in MODES]
        if unknown:
            print("unknown asset keys: " + ", ".join(unknown), file=sys.stderr)
            return 2

    license_path = OUT_DIR / "LICENSE-lucide.txt"
    if not license_path.exists() or args.force:
        license_path.write_bytes(fetch(LICENSE_URL))

    tile = gradient_background()
    total = 0
    with tempfile.TemporaryDirectory(prefix="qishui-modes-") as temp:
        work_dir = Path(temp)
        for key in keys:
            icon_name, label = MODES[key]
            path = build_one(key, icon_name, tile, work_dir, args.force)
            size = path.stat().st_size
            total += size
            print("%-14s %-18s %7d B  %s" % (key, icon_name, size, label))

    manifest = {key: {"icon": icon, "label": label} for key, (icon, label) in MODES.items()}
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("\n%d tile(s), %.1f KB total, written to %s" % (len(keys), total / 1024, OUT_DIR))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
