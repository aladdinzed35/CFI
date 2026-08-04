"""
Subset the self-hosted Latin brand fonts to the characters this product renders.

`public/fonts/README.md` said the faces were "self-hosted and subset". They were
self-hosted; they were not subset. Measured from the running production build,
the three Latin faces were the three largest assets on the homepage:

    geist-mono-variable.woff2   71 368 B   <- the single largest asset
    geist-variable.woff2        69 652 B
    chillax-variable.woff2      55 640 B
                                -------
                                196 660 B  of a ~430 KB page

Geist Mono earned that 71 KB by rendering digits. `[data-numeric]` maps to
`--font-mono` and appears 127 times on the homepage alone — prices, seat counts,
ratings, references — so the face cannot simply be dropped. It can, however,
stop carrying several thousand glyphs to draw « 3 900 DH ».

    python scripts/subset-fonts.py            # rewrites public/fonts/*.woff2
    python scripts/subset-fonts.py --dry-run  # report only

Re-run it after replacing any brand font binary. A missing glyph is not fatal —
every family has a real fallback stack in `globals.css` and `font-display: swap`
— but it is visible, so the ranges below are deliberately generous.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "public" / "fonts"

# fr, en and es text, plus the typography this project actually uses: French
# guillemets « », the curly apostrophe in « l'accès », en/em dashes, the ellipsis
# and the narrow no-break space that fr number formatting inserts into « 3 900 ».
TEXT_RANGES = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x00FF),  # Latin-1 Supplement — accents, guillemets, °, ×
    (0x0100, 0x017F),  # Latin Extended-A — œ, Œ, š, ž
    (0x2010, 0x2027),  # dashes, quotes, ellipsis, bullet
    (0x202F, 0x202F),  # narrow no-break space (fr thousands separator)
    (0x2030, 0x203A),  # ‰, ‹ ›
    (0x20A0, 0x20BF),  # currency signs, incl. €
    (0x2122, 0x2122),  # ™
    (0x2212, 0x2212),  # − true minus: present in the originals, so kept
]

# Geist Mono only ever draws figures and identifiers: « 3 900 DH »,
# « CFI-2026-000107 », « 4,5 ». Letters stay in because references contain them.
MONO_RANGES = [
    (0x0020, 0x007E),
    # The whole Latin-1 Supplement rather than a hand-picked handful. Narrowing
    # it to lowercase accents dropped À, Ç, É, Î, Ô, Ù, · and œ — glyphs the
    # original carried — to save under 2 KB. A monospace face that cannot draw
    # « Coût » in a copied reference is a false economy.
    (0x00A0, 0x00FF),
    (0x0152, 0x0153),  # Œ, œ
    (0x2010, 0x2015),  # hyphens and dashes
    (0x2018, 0x201F),  # ‘ ’ “ ” — curly quotes
    (0x2026, 0x2026),  # …
    (0x202F, 0x202F),
    (0x20AC, 0x20AC),  # €
    (0x2212, 0x2212),  # − true minus: present in the originals, so kept
]

TARGETS = [
    ("geist-variable.woff2", TEXT_RANGES),
    ("chillax-variable.woff2", TEXT_RANGES),
    ("geist-mono-variable.woff2", MONO_RANGES),
]


def unicodes(ranges: list[tuple[int, int]]) -> list[int]:
    out: list[int] = []
    for start, end in ranges:
        out.extend(range(start, end + 1))
    return out


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    if not FONTS.is_dir():
        print(f"no font directory at {FONTS}", file=sys.stderr)
        return 1

    before_total = 0
    after_total = 0

    for name, ranges in TARGETS:
        path = FONTS / name
        if not path.is_file():
            print(f"  SKIP  {name} (not found)")
            continue

        before = path.stat().st_size
        before_total += before

        options = subset.Options()
        options.flavor = "woff2"
        # Keep the variable axes: the design system uses several weights from one
        # binary, and dropping the axes would silently flatten them to Regular.
        options.retain_gids = False
        options.desubroutinize = False
        options.hinting = False
        options.legacy_kern = False
        options.notdef_outline = False
        options.name_IDs = ["*"]
        options.name_legacy = True
        options.layout_features = ["*"]  # keep kern/liga/tnum — tnum is why mono exists here

        font = subset.load_font(str(path), options)
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=unicodes(ranges))
        subsetter.subset(font)

        out = path if not dry_run else path.with_suffix(".probe")
        subset.save_font(font, str(out), options)
        font.close()

        after = out.stat().st_size
        after_total += after
        if dry_run:
            out.unlink()

        pct = 100 - (after * 100 // before) if before else 0
        print(f"  {name:<30} {before:>7,} -> {after:>7,} B  (-{pct}%)")

    saved = before_total - after_total
    print(f"\n  {'total':<30} {before_total:>7,} -> {after_total:>7,} B  (saved {saved:,} B)")
    if dry_run:
        print("  (dry run — nothing written)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
