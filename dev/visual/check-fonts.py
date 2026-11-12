#!/usr/bin/env python3
"""Fail before capture when system fonts differ from the accepted screenshot environment."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


def check(manifest):
    failures = 0
    env = dict(os.environ, FONTCONFIG_FILE=str(Path(__file__).with_name('fontconfig.conf').resolve()))
    for expected in manifest['systemFonts']:
        family, filename = subprocess.check_output(
            ['fc-match', '-f', '%{family}|%{file}', expected['pattern']], text=True, env=env,
        ).split('|', 1)
        digest = hashlib.sha256(Path(filename).read_bytes()).hexdigest()
        matches = family == expected['family'] and digest == expected['sha256']
        print(f"{'PASS' if matches else 'FAIL'} font {expected['pattern']}: {family}, {digest}")
        failures += not matches
    return int(failures > 0)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).resolve().parents[2]
                        / 'tests/visual/accepted/manifest.json')
    args = parser.parse_args()
    raise SystemExit(check(json.loads(args.manifest.read_text())))
