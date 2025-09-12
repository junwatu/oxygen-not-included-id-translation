#!/usr/bin/env python3
import argparse
import shutil
from pathlib import Path

import polib


def count_leading_n(s: str) -> int:
    i = 0
    n = len(s)
    while i < n and s[i] == "\n":
        i += 1
    return i


def count_trailing_n(s: str) -> int:
    i = 0
    n = len(s)
    while i < n and s[n - 1 - i] == "\n":
        i += 1
    return i


def adjust_newlines(text: str, lead: int, trail: int) -> str:
    # normalize then add desired counts
    base = text.lstrip("\n").rstrip("\n")
    return ("\n" * lead) + base + ("\n" * trail)


def process_file(path: Path, dry_run: bool = False, backup: bool = True) -> int:
    po = polib.pofile(str(path), wrapwidth=0)
    changed = 0

    for entry in po:
        # determine reference newline counts from msgid
        ref_text = entry.msgid or ""
        lead_ref = count_leading_n(ref_text)
        trail_ref = count_trailing_n(ref_text)

        def fix_one(s: str) -> str:
            if s is None:
                return s
            lead = count_leading_n(s)
            trail = count_trailing_n(s)
            if lead == lead_ref and trail == trail_ref:
                return s
            return adjust_newlines(s, lead_ref, trail_ref)

        if entry.obsolete:
            continue

        if entry.msgstr:
            new_s = fix_one(entry.msgstr)
            if new_s is not None and new_s != entry.msgstr:
                entry.msgstr = new_s
                changed += 1

        if entry.msgstr_plural:
            for idx, s in list(entry.msgstr_plural.items()):
                new_s = fix_one(s)
                if new_s is not None and new_s != s:
                    entry.msgstr_plural[idx] = new_s
                    changed += 1

    if changed and not dry_run:
        if backup:
            shutil.copy2(path, path.with_suffix(path.suffix + ".bak"))
        po.save(str(path))

    return changed


def main():
    ap = argparse.ArgumentParser(description="Fix msgid/msgstr leading/trailing \\n mismatches in .po files")
    ap.add_argument("po_file", nargs="?", default="strings.po", help="Path to .po file (default: strings.po)")
    ap.add_argument("--dry-run", action="store_true", help="Only report changes, do not modify file")
    ap.add_argument("--no-backup", action="store_true", help="Do not create .bak backup before saving")
    args = ap.parse_args()

    path = Path(args.po_file)
    if not path.exists():
        raise SystemExit(f"File not found: {path}")

    changed = process_file(path, dry_run=args.dry_run, backup=not args.no_backup)
    if args.dry_run:
        print(f"Would update {changed} translation string(s)")
    else:
        print(f"Updated {changed} translation string(s)")


if __name__ == "__main__":
    main()

