#!/usr/bin/env python3
"""
Generates the app icon files under packaging/icons/ from a scaled-up,
higher-resolution redraw of the same mark app/theme.py's draw_logo_mark()
draws on a Tkinter Canvas at 28x28 for the header -- a rounded square in
the app's brand blue (Crisp Light's ACCENT, #2F6FED, since the icon has to
be one fixed color regardless of which of the seven themes is active) with
a white calendar "header bar" and two white binder-ring circles.

Run this once (python3 packaging/make_icons.py) any time the mark's design
changes; the generated files are committed so a fresh checkout/build doesn't
need Pillow just to have an icon. Needs Pillow (pip install pillow --break-
system-packages), which is NOT in requirements.txt since the running app
itself never needs it -- only this one-off packaging step does.

Produces:
  icons/icon.png   1024x1024, source for everything else + the Linux .desktop icon
  icons/icon.ico    Windows icon (multiple sizes bundled in one file)
  icons/icon.icns   macOS icon (hand-assembled from PNGs at Apple's required
                    sizes -- no macOS-only tools like iconutil needed to
                    build it, so this works from any platform)
"""
import io
import os
import struct

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "icons")

ACCENT = "#2F6FED"  # Crisp Light's ACCENT -- see app/theme.py
WHITE = "#FFFFFF"


def _rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_mark(size: int) -> Image.Image:
    """Redraws app.theme.draw_logo_mark's proportions at `size`x`size`
    instead of the fixed 28x28 the in-app header canvas uses, with a
    transparent background so it drops cleanly onto any OS's icon
    treatment (Windows/Linux add their own square backdrop; macOS applies
    its own rounded-corner mask over whatever shape is inside)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = round(size * 1 / 28)
    inner = size - 2 * pad
    _rounded_rect(draw, (pad, pad, pad + inner, pad + inner), radius=round(inner * 7 / 26), fill=ACCENT)

    bar_x0 = pad + round(inner * 5 / 26)
    bar_x1 = pad + inner - round(inner * 5 / 26)
    bar_y0 = pad + round(inner * 5 / 26)
    bar_y1 = pad + round(inner * 10 / 26)
    _rounded_rect(draw, (bar_x0, bar_y0, bar_x1, bar_y1), radius=round(inner * 2 / 26), fill=WHITE)

    ring_r0 = round(inner * 5 / 26)
    ring_r1 = round(inner * 14 / 26)
    ring_size = round(inner * 7 / 26)
    draw.ellipse((pad + ring_r0, pad + ring_r1, pad + ring_r0 + ring_size, pad + ring_r1 + ring_size), fill=WHITE)
    draw.ellipse((pad + inner - ring_r0 - ring_size, pad + ring_r1,
                  pad + inner - ring_r0, pad + ring_r1 + ring_size), fill=WHITE)

    return img


def write_icns(png_1024: Image.Image, path: str):
    """Hand-assembles a modern (PNG-payload) .icns file -- the format is
    just a magic header followed by a sequence of (4-byte type code, 4-byte
    big-endian length, PNG bytes) chunks, one per required size. No
    macOS-only tooling (iconutil, sips) needed to produce this, so it works
    on any platform this script runs on."""
    # (icns type code, edge length in pixels)
    sizes = [
        (b"icp4", 16), (b"icp5", 32), (b"icp6", 64),
        (b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024),
    ]
    chunks = []
    for type_code, edge in sizes:
        resized = png_1024.resize((edge, edge), Image.LANCZOS)
        buf = io.BytesIO()
        resized.save(buf, format="PNG")
        data = buf.getvalue()
        chunk = type_code + struct.pack(">I", 8 + len(data)) + data
        chunks.append(chunk)

    body = b"".join(chunks)
    total_len = 8 + len(body)
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", total_len) + body)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    master = draw_mark(1024)
    master.save(os.path.join(OUT_DIR, "icon.png"))

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    master.save(
        os.path.join(OUT_DIR, "icon.ico"),
        sizes=[(s, s) for s in ico_sizes],
    )

    write_icns(master, os.path.join(OUT_DIR, "icon.icns"))

    print(f"Wrote icon.png, icon.ico, icon.icns to {OUT_DIR}")


if __name__ == "__main__":
    main()
