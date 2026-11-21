"""Derive the tauri icon sources from the artwork in src-tauri/icons/source.

    python scripts/icon-sources.py
    npx tauri icon src-tauri/icons/source/manifest.json

chayote.png is the square artwork (the fruit on a flat navy field). From it:
  icon.png         desktop/legacy icon: the artwork in a rounded square, with a
                   transparent margin, so it is not a hard-edged tile
  android-fg.png   adaptive foreground: the fruit cut out of the field, inside
                   the 66 dp safe circle (the field becomes the background
                   color) — the launcher's mask crops the outer 18 dp of every
                   side, so artwork that fills the square reads as zoomed in
  android-mono.png themed icon: only the green facets, the ribs cut out
and manifest.json gets the field's color as bg_color. Needs Pillow.

Adapted from the same script in the sibling Physalis project, whose icon is the
reference for how large the fruit should sit on a home screen.
"""

import json
import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = pathlib.Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "source"
SIZE = 1024


def field_color(im):
    w, h = im.size
    border = [im.getpixel((x, y)) for x in range(0, w, 16) for y in (4, h - 5)]
    border += [im.getpixel((x, y)) for y in range(0, h, 16) for x in (4, w - 5)]
    return tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))


def fruit_mask(im, bg):
    """The fruit and its stem: everything that is not the field."""
    smooth = im.filter(ImageFilter.GaussianBlur(3))
    flat = Image.new("RGB", im.size, bg)
    diff = ImageChops.difference(smooth, flat).convert("L")
    mask = diff.point(lambda v: 255 if v > 24 else 0).filter(ImageFilter.MedianFilter(5))
    w, h = im.size
    ImageDraw.Draw(mask).rectangle((0, 0, w - 1, h - 1), outline=0, width=24)
    ImageDraw.floodfill(mask, (0, 0), 128)
    mask = mask.point(lambda v: 0 if v == 128 else 255)
    return mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.5))


def facet_mask(im):
    """The green facets and the stem, without the navy ribs between them."""
    r, g, b = im.split()
    green = ImageChops.subtract(g, b)
    return green.point(lambda v: 255 if v > 60 else 0).filter(ImageFilter.GaussianBlur(1.5))


def place(layer, bbox, height):
    """Scale the bbox of layer to height px, centred on a SIZE canvas."""
    crop = layer.crop(bbox)
    scale = height / crop.height
    crop = crop.resize((round(crop.width * scale), round(height)), Image.LANCZOS)
    out = Image.new(layer.mode, (SIZE, SIZE), (0, 0, 0, 0) if layer.mode == "RGBA" else 0)
    out.paste(crop, ((SIZE - crop.width) // 2, (SIZE - crop.height) // 2))
    return out


def main():
    art = Image.open(SRC / "chayote.png").convert("RGB")
    bg = field_color(art)
    mask = fruit_mask(art, bg)
    bbox = mask.getbbox()

    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    side = (bbox[3] - bbox[1]) / 0.80
    square = art.crop((round(cx - side / 2), round(cy - side / 2), round(cx + side / 2), round(cy + side / 2)))
    inner = SIZE - 64
    square = square.resize((inner, inner), Image.LANCZOS)
    round_mask = Image.new("L", (inner * 4, inner * 4), 0)
    ImageDraw.Draw(round_mask).rounded_rectangle(
        (0, 0, inner * 4 - 1, inner * 4 - 1), radius=round(inner * 0.22 * 4), fill=255
    )
    round_mask = round_mask.resize((inner, inner), Image.LANCZOS)
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(square, (32, 32), round_mask)
    icon.save(SRC / "icon.png")

    fruit = art.convert("RGBA")
    fruit.putalpha(mask)
    height = SIZE * 62 / 108
    place(fruit, bbox, height).save(SRC / "android-fg.png")

    facets = facet_mask(art)
    mono = Image.new("RGBA", art.size, (255, 255, 255, 0))
    mono.putalpha(ImageChops.multiply(facets, mask))
    place(mono, bbox, height).save(SRC / "android-mono.png")

    manifest = {
        "default": "icon.png",
        "bg_color": "#%02x%02x%02x" % bg,
        "android_fg": "android-fg.png",
        "android_fg_scale": 100,
        "android_monochrome": "android-mono.png",
    }
    (SRC / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", newline="\n")
    print("field", manifest["bg_color"], "fruit bbox", bbox)


if __name__ == "__main__":
    main()
