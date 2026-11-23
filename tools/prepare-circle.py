#!/usr/bin/env python3
"""Prépare le cercle magique (Zoltraak) du fond d'écran à partir de VOTRE image.

  python3 tools/prepare-circle.py assets/zoltrak.png

Deux cas gérés automatiquement :
 - image déjà détourée (fond transparent) : on garde sa transparence telle quelle ;
 - image sur fond uni (traits clairs sur gris) : le fond est retiré par la luminosité et tout ce qui
   est hors du cercle (étiquette, texte) est effacé.
Dans les deux cas les traits deviennent lilas, sur fond transparent, et l'image est agrandie 2× (lissée).
Résultat : assets/zoltraak-circle.png, utilisé par l'interface et l'installateur.
"""
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

TINT = (205, 184, 255)          # lilas
src = sys.argv[1] if len(sys.argv) > 1 else "assets/zoltrak.png"
out = sys.argv[2] if len(sys.argv) > 2 else "assets/zoltraak-circle.png"

img = Image.open(src)
w, h = img.size
alpha_src = img.getchannel("A") if img.mode in ("RGBA", "LA") else None

if alpha_src is not None and alpha_src.getextrema()[0] == 0 and sum(1 for v in alpha_src.getdata() if v == 0) > w * h * 0.2:
    # Cas 1 : déjà détourée
    alpha = alpha_src.point(lambda a: min(255, int(a * 1.1)))
else:
    # Cas 2 : traits clairs sur fond uni
    gray = img.convert("L")
    cx, cy, R = w / 2, h / 2, min(w, h) * 0.405
    bg = sum(gray.crop((int(w * .9), int(h * .9), w, h)).getdata()) / ((w - int(w * .9)) * (h - int(h * .9)))
    inside = Image.new("L", (w, h), 0)
    ImageDraw.Draw(inside).ellipse((cx - R, cy - R, cx + R, cy + R), fill=255)
    vals = sorted(p for p, m in zip(gray.getdata(), inside.getdata()) if m)
    span = max(vals[int(len(vals) * 0.995)] - bg, 1)
    alpha = gray.point(lambda p: max(0, min(255, int((p - bg) / span * 255 * 1.15))))
    alpha = ImageChops.multiply(alpha, inside.filter(ImageFilter.GaussianBlur(1.5)))

rgba = Image.new("RGBA", (w, h), TINT + (0,))
rgba.putalpha(alpha)
bbox = rgba.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
if bbox:                                     # recadre au plus près du dessin, en carré
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    half = max(bbox[2] - bbox[0], bbox[3] - bbox[1]) / 2 + 3
    rgba = rgba.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half)))
rgba = rgba.resize((rgba.width * 2, rgba.height * 2), Image.LANCZOS)
rgba.save(out, optimize=True)
print(f"{out} écrit ({rgba.width}×{rgba.height} px)")
