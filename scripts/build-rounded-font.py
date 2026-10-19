"""Build public/fonts/koma-rounded from Resource Han Rounded CN.

  python3 scripts/build-rounded-font.py <ttf-dir> <slices.css>

<ttf-dir> holds ResourceHanRoundedCN-{Regular,Medium,Bold}.ttf from the
RHR-CN-0.990 release. <slices.css> is any stylesheet whose commented
@font-face blocks carry the slice ranges; the generated index.css works, so a
rebuild keeps the same slicing. Needs fontTools 4.60.1 and brotli 1.1.0.

Two changes go beyond subsetting, so the result is renamed (the Source Han
portions reserve the name "Source"): U+00B7 and U+00D7 get proportional
glyphs, built from the period and the plus, because the CN font draws both
full width and the UI sets them between Latin text and digits.
"""

import re
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from math import pi
from pathlib import Path

from fontTools import subset
from fontTools.misc.transform import Transform
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/fonts/koma-rounded"
FAMILY, POSTSCRIPT, SLUG = "Koma Rounded", "KomaRounded", "koma-rounded"
# Static weights; the UI's semibold (600) uses Bold.
WEIGHTS = {400: ("Regular", "400"), 500: ("Medium", "500"), 700: ("Bold", "600 700")}
NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 10, 13, 14, 16, 17]
VERTICAL = {"valt", "vert", "vkrn", "vpal", "vrt2", "vhal", "vchw"}


def codepoints(text):
    result = set()
    for part in text.split(","):
        start, _, end = part.strip()[2:].partition("-")
        result.update(range(int(start, 16), int(end or start, 16) + 1))
    return result


def unicode_range(values):
    values, parts = sorted(values), []
    start = previous = values[0]
    for value in values[1:] + [None]:
        if value is not None and value == previous + 1:
            previous = value
            continue
        parts.append(f"U+{start:x}" + (f"-{previous:x}" if previous != start else ""))
        if value is not None:
            start = previous = value
    return ",".join(parts)


def read_slices(css):
    slices = {}
    pattern = r"/\*\s*(\S+)\s*\*/\s*@font-face\s*\{[^}]*?unicode-range:\s*([^;]+);"
    for name, ranges in re.findall(pattern, css):
        key = re.sub(r"^(?:noto-sans-sc|koma-rounded)-\[?([a-z0-9-]+?)\]?-(?:wght|\d{3})-normal$", r"\1", name)
        slices.setdefault(key, set()).update(codepoints(ranges))
    return slices


def add_glyph(font, name, source, transform):
    pen = TTGlyphPen(None)
    font.getGlyphSet()[source].draw(TransformPen(pen, transform))
    glyph = pen.glyph()
    font["glyf"][name] = glyph
    glyph.recalcBounds(font["glyf"])
    font["hmtx"][name] = (font["hmtx"][source][0], glyph.xMin)


def prepare(source, target):
    font = TTFont(source)
    for tag in ("vhea", "vmtx", "VORG", "BASE"):
        if tag in font:
            del font[tag]
    glyf, cap = font["glyf"], font["OS/2"].sCapHeight
    # A period raised to the middle of the capitals, with the period's width.
    period = glyf["period"]
    add_glyph(font, "periodcentered.koma", "period", Transform().translate(0, round(cap / 2 - (period.yMin + period.yMax) / 2)))
    # The plus turned a quarter, so the stroke matches the plus exactly.
    plus = glyf["plus"]
    cx, cy = (plus.xMin + plus.xMax) / 2, (plus.yMin + plus.yMax) / 2
    add_glyph(font, "multiply.koma", "plus", Transform().translate(cx, cy).rotate(pi / 4).translate(-cx, -cy))
    font.setGlyphOrder(glyf.glyphOrder)
    for table in font["cmap"].tables:
        mapping = getattr(table, "cmap", None)
        if table.isUnicode() and mapping:
            mapping.update({cp: name for cp, name in ((0xB7, "periodcentered.koma"), (0xD7, "multiply.koma")) if cp in mapping})
    names = font["name"]
    for record in names.names:
        if record.nameID in (1, 3, 4, 6, 16, 17, 21, 22):
            text = record.toUnicode().replace("Resource Han Rounded CN", FAMILY).replace("Resource-Han-Rounded-CN", POSTSCRIPT)
            record.string = text
    names.setName(
        "Modified from Resource Han Rounded CN 0.990 for Koma Image: web slices, proportional U+00B7 and U+00D7.",
        10, 3, 1, 0x409,
    )
    font.save(target)
    return set(font.getBestCmap())


def build(job):
    source, values, target = job
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.name_IDs = NAME_IDS
    options.layout_features = [tag for tag in options.layout_features if tag not in VERTICAL]
    font = subset.load_font(source, options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=values)
    subsetter.subset(font)
    subset.save_font(font, target, options)
    return target


def main(ttf_dir, slices_css):
    slices = read_slices(Path(slices_css).read_text())
    files = OUT / "files"
    files.mkdir(parents=True, exist_ok=True)
    for old in files.glob("*.woff2"):
        old.unlink()
    blocks, jobs = [], []
    with tempfile.TemporaryDirectory() as temporary:
        for weight, (style, descriptor) in WEIGHTS.items():
            prepared = str(Path(temporary) / f"{style}.ttf")
            covered = prepare(Path(ttf_dir) / f"ResourceHanRoundedCN-{style}.ttf", prepared)
            for key, values in slices.items():
                # The written range stays the slice's own, which is shorter; a
                # character the font lacks just falls through to the next family.
                if not values & covered:
                    continue
                label = f"[{key}]" if key.isdigit() else key
                name = f"{SLUG}-{key}-{weight}-normal.woff2"
                jobs.append((prepared, values, str(files / name)))
                blocks.append(
                    f"/* {SLUG}-{label}-{weight}-normal */\n@font-face {{\n  font-family: '{FAMILY}';\n"
                    f"  font-style: normal;\n  font-display: swap;\n  font-weight: {descriptor};\n"
                    f"  src: url(./files/{name}) format('woff2');\n  unicode-range: {unicode_range(values)};\n}}\n"
                )
        with ProcessPoolExecutor() as pool:
            for done in pool.map(build, jobs, chunksize=4):
                print(Path(done).name)
    (OUT / "index.css").write_text("\n".join(blocks))


if __name__ == "__main__":
    main(*sys.argv[1:3])
