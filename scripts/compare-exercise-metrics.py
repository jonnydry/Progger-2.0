#!/usr/bin/env python3
"""Side-by-side table of `exercise-metrics.mts` JSON files.

    scripts/compare-exercise-metrics.py REVIEW baseline.json after.json ...

SECTION is REVIEW, REVIEW_eighths or SWEEP. Every scalar metric prints in one
row, in the order the script emits it. Nested maps (skip kinds, per-lane bar
counts) and lists are skipped: compare those by eye in the JSON.
"""
import json
import sys

GROUPS = ['rhythm', 'pitch', 'figures', 'landing', 'hand', 'health']
WIDTH = 18


def label(name: str, sources: list[str]) -> str:
    """Last 16 characters of the file name, so a timestamped run still fits."""
    stem = name.rsplit('/', 1)[-1].replace('.json', '')
    return f'{stem[-16:]:>{WIDTH}}'


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write(__doc__)
        return 2
    section = sys.argv[1]
    files = sys.argv[2:]
    loaded = [json.load(open(path)) for path in files]
    tables = [data[section] for data in loaded]
    print(f'{"metric (" + section + ")":42}' + ''.join(label(f, files) for f in files))
    print(f'{"failures":42}' + ''.join(f'{data["failures"]:>{WIDTH}}' for data in loaded))
    for group in GROUPS:
        for key in tables[0][group]:
            values = [table[group].get(key) for table in tables]
            if isinstance(values[0], (list, dict)):
                continue
            print(f'{group}.{key:35}' + ''.join(f'{str(value):>{WIDTH}}' for value in values))
    return 0


if __name__ == '__main__':
    sys.exit(main())
