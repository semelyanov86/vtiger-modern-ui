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
    expected_hashes = {font['sha256'] for font in manifest['systemFonts']}
    inventory = subprocess.check_output(['fc-list', '-f', '%{file}\n'], text=True, env=env)
    for filename in sorted({Path(name).resolve() for name in inventory.splitlines() if name}):
        if hashlib.sha256(filename.read_bytes()).hexdigest() not in expected_hashes:
            print(f'FAIL font inventory: unpinned file {filename.name}')
            failures += 1
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
