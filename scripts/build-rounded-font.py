"""Offline WOFF2 build from config/fonts.json and its Unicode range manifest.

  python3 scripts/build-rounded-font.py <ttf-dir> [--output <family-dir>]

Only this optional binary rebuild needs the pinned fontTools and brotli versions
declared in the manifest. Normal app builds use Node and the existing WOFF2s.
U+00B7 and U+00D7 retain their proportional glyph patches; modified fonts are
renamed because the Source Han portions reserve the name "Source".
"""

import argparse
import json
import os
import re
import shutil
import tempfile
from concurrent.futures import ProcessPoolExecutor
from importlib.metadata import PackageNotFoundError, version
from math import pi
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 10, 13, 14, 16, 17]
VERTICAL = {"valt", "vert", "vkrn", "vpal", "vrt2", "vhal", "vchw"}


def codepoints(text):
    result = set()
    for part in text.split(","):
        match = re.fullmatch(r"U\+([\da-f]{1,6})(?:-([\da-f]{1,6}))?", part.strip(), re.I)
        if not match:
            raise ValueError(f"Invalid Unicode range: {part}")
        start, end = int(match[1], 16), int(match[2] or match[1], 16)
        if start > end or end > 0x10FFFF:
            raise ValueError(f"Unicode range out of bounds: {part}")
        result.update(range(start, end + 1))
    return result


def read_configuration():
    manifest = json.loads((ROOT / "config/fonts.json").read_text())
    if manifest["version"] != 1:
        raise ValueError("Unsupported font manifest version")
    family = next(f for f in manifest["families"] if f["id"] == "koma-rounded")
    if not re.fullmatch(r"config/font-ranges/[a-z0-9-]+\.json", family["ranges"]):
        raise ValueError("Invalid range manifest path")
    entries = json.loads((ROOT / family["ranges"]).read_text())
    slices = {item["id"]: codepoints(item["unicodeRange"]) for item in entries}
    if not slices or len(slices) != len(entries):
        raise ValueError("Empty or duplicate Unicode slices")
    for key in [*slices, *(w["id"] for w in family["weights"])]:
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key):
            raise ValueError("Invalid font file ID")
    return family, slices


def add_glyph(font, name, source, transform):
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    pen = TTGlyphPen(None)
    font.getGlyphSet()[source].draw(TransformPen(pen, transform))
    glyph = pen.glyph()
    font["glyf"][name] = glyph
    glyph.recalcBounds(font["glyf"])
    font["hmtx"][name] = (font["hmtx"][source][0], glyph.xMin)


def prepare(source, target, family):
    from fontTools.misc.transform import Transform
    from fontTools.ttLib import TTFont

    font = TTFont(source)
    for tag in ("vhea", "vmtx", "VORG", "BASE"):
        if tag in font:
            del font[tag]
    glyf, cap = font["glyf"], font["OS/2"].sCapHeight
    period = glyf["period"]
    add_glyph(font, "periodcentered.koma", "period", Transform().translate(0, round(cap / 2 - (period.yMin + period.yMax) / 2)))
    plus = glyf["plus"]
    cx, cy = (plus.xMin + plus.xMax) / 2, (plus.yMin + plus.yMax) / 2
    add_glyph(font, "multiply.koma", "plus", Transform().translate(cx, cy).rotate(pi / 4).translate(-cx, -cy))
    font.setGlyphOrder(glyf.glyphOrder)
    for table in font["cmap"].tables:
        mapping = getattr(table, "cmap", None)
        if table.isUnicode() and mapping:
            mapping.update({cp: name for cp, name in ((0xB7, "periodcentered.koma"), (0xD7, "multiply.koma")) if cp in mapping})
    original = family["source"]
    names = font["name"]
    for record in names.names:
        if record.nameID in (1, 3, 4, 6, 16, 17, 21, 22):
            text = record.toUnicode().replace(original["family"], family["family"]).replace(original["postscriptFamily"], original["postscript"])
            record.string = text
    names.setName(
        f"Modified from {original['family']} {original['version']} for Koma Image: web slices, proportional U+00B7 and U+00D7.",
        10, 3, 1, 0x409,
    )
    font.save(target)
    return set(font.getBestCmap())


def build(job):
    from fontTools import subset

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


def main(ttf_dir, output=None, workers=4):
    family, slices = read_configuration()
    sources = {}
    for weight in family["weights"]:
        source = ttf_dir / family["source"]["filePattern"].format(style=weight["sourceStyle"])
        if not source.is_file():
            raise ValueError(f"Missing source font: {source}")
        sources[weight["id"]] = source
    for package, expected in [("fonttools", family["source"]["fontTools"]), ("brotli", family["source"]["brotli"])]:
        try:
            actual = version(package)
        except PackageNotFoundError:
            raise ValueError(f"Offline rebuild requires {package}=={expected}") from None
        if actual != expected:
            raise ValueError(f"Offline rebuild requires {package}=={expected}; found {actual}")
    if workers < 1:
        raise ValueError("workers must be positive")
    output = output or ROOT / "public/fonts" / family["id"]
    output.mkdir(parents=True, exist_ok=True)
    files = output / "files"
    if files.exists() and (not files.is_dir() or files.is_symlink()):
        raise ValueError("Output files must be a regular directory")
    # Stage on the same filesystem. A failed build never clears the live files.
    temporary = Path(tempfile.mkdtemp(prefix=".font-build-", dir=output))
    staged, previous = temporary / "files", temporary / "previous-files"
    staged.mkdir()
    try:
        jobs = []
        for weight in family["weights"]:
            prepared = temporary / f"{weight['id']}.ttf"
            covered = prepare(sources[weight["id"]], prepared, family)
            for key, values in slices.items():
                if not values & covered:
                    raise ValueError(f"Empty font slice: {key}, weight {weight['id']}")
                name = f"{family['id']}-{key}-{weight['id']}-{family['style']}.woff2"
                jobs.append((str(prepared), values, str(staged / name)))
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for _ in pool.map(build, jobs, chunksize=4):
                pass
        if len(list(staged.glob("*.woff2"))) != len(jobs):
            raise ValueError("Incomplete font build")
        if files.exists():
            files.rename(previous)
        try:
            staged.rename(files)
        except BaseException:
            if previous.exists():
                previous.rename(files)
            raise
        if previous.exists():
            shutil.rmtree(previous)
        print(f"Built {len(jobs)} WOFF2 files in {files}; run npm run fonts:build for CSS.")
    finally:
        # Preserve a recoverable original if restoring its directory failed.
        if not previous.exists():
            shutil.rmtree(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ttf_dir", type=Path)
    parser.add_argument("--output", type=Path, help="Family directory, default public/fonts/koma-rounded")
    parser.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    args = parser.parse_args()
    try:
        main(args.ttf_dir, args.output, args.workers)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Font build failed: {error}\n")
