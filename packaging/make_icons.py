#!/usr/bin/env python3
"""
Generates the app icon files under packaging/icons/ from a scaled-up,
higher-resolution redraw of the QUASAR mark: a clock-faced core sphere
wrapped in a tilted, Saturn-style ring system with a bright shooting-star
taper on its near edge, plus a few scattered stars. Same design as
app/theme.py's draw_logo_mark() (which draws it on a Tkinter Canvas for
the in-app header at 28x28), but rendered independently here rather than
shared code -- Tkinter has no native support for rotated ellipses, alpha
blending, or anti-aliasing, so that version fakes all three with plain
point-sampled shapes and pre-blended solid colors, while this one uses
Pillow's real RGBA compositing and Image.rotate() for a cleaner result.
Always uses the fixed brand blue (Crisp Light's ACCENT, #2F6FED) rather
than the app's live theme accent, since the packaged icon can't change
color with whichever of the app's themes happens to be active.

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

from PIL import Image, ImageDraw, ImageColor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "icons")

ACCENT = "#2F6FED"  # Crisp Light's ACCENT -- see app/theme.py

# Every coordinate in draw_mark() below lives in this fixed 0-120 design
# space (matching the SVG mockups the mark's proportions were designed
# and approved in) and gets scaled up to whatever `size` is requested --
# see the unit/px/pt helpers inside draw_mark. Retune the mark by editing
# the numbers used there directly rather than adding new constants here.
DESIGN_SPACE = 120


def _rgba(hex_color: str, alpha: int = 255):
    r, g, b = ImageColor.getcolor(hex_color, "RGB")
    return (r, g, b, alpha)


def _dashed_ellipse(draw, box, width, color, dash_deg=10, gap_deg=14):
    """PIL has no dashed-ellipse primitive -- approximate one with a
    series of short arc() segments, used for the ring system's outer
    "dust" band (see draw_mark)."""
    period = dash_deg + gap_deg
    angle = 0.0
    while angle < 360.0:
        draw.arc(box, start=angle, end=min(angle + dash_deg, 360.0), fill=color, width=width)
        angle += period


def _composite_layer(base: Image.Image, layer: Image.Image, anchor_x: float, anchor_y: float) -> Image.Image:
    """Alpha-composite a smaller square RGBA `layer` onto `base`, centered
    at (anchor_x, anchor_y) in base's own coordinate space. Image.paste()
    with a mask doesn't reliably handle a source that already carries its
    own partial alpha (as every rotated ring/arc layer here does); placing
    it onto a same-size transparent canvas first and using
    Image.alpha_composite for the actual blend is what correctly handles
    that."""
    full = Image.new("RGBA", base.size, (0, 0, 0, 0))
    half = layer.width / 2
    full.paste(layer, (round(anchor_x - half), round(anchor_y - half)))
    return Image.alpha_composite(base, full)


def draw_mark(size: int) -> Image.Image:
    """Redraws the QUASAR mark at `size`x`size` with a transparent
    background, so it drops cleanly onto any OS's icon treatment (Windows/
    Linux add their own square backdrop; macOS applies its own rounded-
    corner mask over whatever shape is inside)."""
    unit = size / DESIGN_SPACE

    def px(v):
        return v * unit

    def pt(x, y):
        return (x * unit, y * unit)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # ---- Saturn-style ring system: three concentric bands (a dashed
    # "dust" ring, a middle band, and a thicker inner band closest to the
    # sphere), drawn horizontally on their own square layer and rotated
    # as a whole -- Pillow, like Tkinter, can only draw axis-aligned
    # ellipses, so a tilted one always has to be built this way.
    ring_layer_size = round(px(140))  # generous margin around rx=60 + stroke width after rotation
    ring_img = Image.new("RGBA", (ring_layer_size, ring_layer_size), (0, 0, 0, 0))
    ring_draw = ImageDraw.Draw(ring_img)
    rc = ring_layer_size / 2

    def ellipse_box(rx, ry):
        return (rc - px(rx), rc - px(ry), rc + px(rx), rc + px(ry))

    _dashed_ellipse(ring_draw, ellipse_box(60, 11), max(1, round(px(2))), _rgba(ACCENT, 70))
    ring_draw.ellipse(ellipse_box(54, 9.5), outline=_rgba(ACCENT, 107), width=max(1, round(px(2.5))))
    ring_draw.ellipse(ellipse_box(48, 8), outline=_rgba(ACCENT, 128), width=max(1, round(px(5))))

    anchor_x, anchor_y = pt(60, 66)  # the ring group's own center, in design space
    # SVG's rotate(-20 ...) (used to design/approve this mark) is 20
    # degrees counter-clockwise on screen; Image.rotate()'s positive
    # angles are also counter-clockwise, so +20 here reproduces the same
    # tilt exactly (verified against Image.rotate's actual behavior,
    # which is *not* the plain textbook rotation-matrix sign convention
    # once you account for y increasing downward).
    img = _composite_layer(img, ring_img.rotate(20, resample=Image.BICUBIC), anchor_x, anchor_y)

    # ---- core sphere ----------------------------------------------------
    draw = ImageDraw.Draw(img)
    sx, sy = pt(60, 50)
    r = px(25)
    draw.ellipse((sx - r, sy - r, sx + r, sy + r), fill=_rgba(ACCENT))

    # ---- watch-face bezel: semi-transparent white over the now-opaque
    # sphere, so (unlike the opaque shapes above) it needs its own layer
    # composited in rather than a direct draw, which would just replace
    # the sphere pixels underneath instead of blending with them.
    bezel_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(bezel_layer).ellipse(
        (sx - px(19.5), sy - px(19.5), sx + px(19.5), sy + px(19.5)),
        outline=_rgba("#FFFFFF", 77), width=max(1, round(px(1.5))))
    img = Image.alpha_composite(img, bezel_layer)
    draw = ImageDraw.Draw(img)

    # ---- clock hands, fixed at 10:10 (the classic "friendly" clock
    # position) -- the timesheet reference the halo design was missing.
    hx, hy = pt(52.6, 44.8)  # hour hand tip
    mx, my = pt(72.1, 43)    # minute hand tip
    hand_width = max(1, round(px(3.6)))
    draw.line([(sx, sy), (hx, hy)], fill=(255, 255, 255, 255), width=hand_width)
    draw.line([(sx, sy), (mx, my)], fill=(255, 255, 255, 255), width=hand_width)
    cr = px(2.4)
    draw.ellipse((sx - cr, sy - cr, sx + cr, sy + cr), fill=(255, 255, 255, 255))

    # ---- the ring's front/near edge, tapering from dim to a bright
    # near-white point like a shooting star -- three nested partial arcs
    # sharing the same start angle, each shorter and brighter than the
    # last. Also tilted and also drawn over the opaque sphere, so it's a
    # third rotated layer of its own composited on top of everything so
    # far.
    arc_layer = Image.new("RGBA", (ring_layer_size, ring_layer_size), (0, 0, 0, 0))
    arc_box = ellipse_box(48, 8)
    for start, end, color, width in (
        (20, 160, _rgba("#6EA0FF", 143), max(1, round(px(4)))),
        (20, 100, _rgba("#B7D0FF", 204), max(1, round(px(3.5)))),
        (20, 60, _rgba("#F3F8FF", 255), max(1, round(px(3)))),
    ):
        # Each arc is composited onto the growing arc_layer individually
        # (rather than all three drawn directly onto one shared layer)
        # since they deliberately overlap -- a plain draw call would just
        # replace whatever the previous, dimmer arc left there instead of
        # blending on top of it.
        step = Image.new("RGBA", arc_layer.size, (0, 0, 0, 0))
        ImageDraw.Draw(step).arc(arc_box, start=start, end=end, fill=color, width=width)
        arc_layer = Image.alpha_composite(arc_layer, step)
    img = _composite_layer(img, arc_layer.rotate(20, resample=Image.BICUBIC), anchor_x, anchor_y)
    draw = ImageDraw.Draw(img)

    # ---- a scattered handful of stars for the "in space" feel -- each
    # one sits on what's still fully transparent background at this
    # point, so a plain draw (no compositing layer) is correct here.
    def sparkle(cx, cy, long_r, short_r, alpha):
        k = short_r * 0.70710678  # short_r at 45 degrees
        points = [pt(cx, cy - long_r), pt(cx + k, cy - k), pt(cx + long_r, cy),
                  pt(cx + k, cy + k), pt(cx, cy + long_r), pt(cx - k, cy + k),
                  pt(cx - long_r, cy), pt(cx - k, cy - k)]
        draw.polygon(points, fill=_rgba("#FFFFFF", alpha))

    sparkle(100, 18, 6, 2, 230)
    sparkle(14, 24, 3, 1, 140)
    sparkle(10, 100, 3.5, 1.2, 153)
    dot_x, dot_y = pt(108, 102)
    dot_r = px(1.8)
    draw.ellipse((dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r), fill=_rgba("#FFFFFF", 128))

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
