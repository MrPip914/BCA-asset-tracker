#!/usr/bin/env python3
"""Regenerates the install icons and per-tenant web manifests (pwa/, manifest-<id>.json).

PLACEHOLDER icons: the tenant's brand colour with its short initials. Replace any
pwa/icon-<id>-*.png with a real logo of the same size and these files need no
re-run (the manifests only name them). Run: python3 gen-pwa.py  (needs Pillow).
Keep TENANTS in step with clients.js (brandDark / appName).
"""
import json
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
TENANTS = {
    "bca": ("BCA Asset Tracker", "Assets", "BCA", "#3E5054", "#F4F0E6"),
    "3c":  ("3C Asset Tracker", "Assets", "3C",  "#3E5054", "#F4F0E6"),
    "dev": ("Asset Tracker (dev)", "Assets dev", "DEV", "#3E5054", "#F4F0E6"),
}

def icon(size, text, bg, fg, safe):
    im = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(im)
    # Maskable icons get cropped to a circle/squircle: keep the mark in the middle 60%.
    box = size * (0.6 if safe else 0.8)
    fs = int(box / max(len(text), 2) * 1.5)
    f = ImageFont.truetype(FONT, fs)
    while d.textlength(text, font=f) > box and fs > 8:
        fs -= 2
        f = ImageFont.truetype(FONT, fs)
    d.text((size / 2, size / 2), text, font=f, fill=fg, anchor="mm")
    return im

for tid, (name, short, text, bg, fg) in TENANTS.items():
    for size, kind, safe in ((192, "192", False), (512, "512", False), (512, "maskable", True), (180, "apple", True)):
        icon(size, text, bg, fg, safe).save(f"pwa/icon-{tid}-{kind}.png")
    manifest = {
        "name": name, "short_name": short,
        "start_url": f"./?c={tid}", "scope": "./", "id": f"./?c={tid}",
        "display": "standalone", "background_color": fg, "theme_color": bg,
        "icons": [
            {"src": f"pwa/icon-{tid}-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": f"pwa/icon-{tid}-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": f"pwa/icon-{tid}-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    json.dump(manifest, open(f"manifest-{tid}.json", "w"), indent=2)
    open(f"manifest-{tid}.json", "a").write("\n")
