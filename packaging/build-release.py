#!/usr/bin/env python3
"""Build source and install ZIPs twice in independent temporary directories.

Requires Node 24/npm, Python 3.10+, and the committed lockfile. No CRM access.
Output includes byte-level reproduction evidence, SHA-256 and per-file reports.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
import zlib

REPO = Path(__file__).resolve().parent.parent
EXCLUDED_DIRS = {'.git', '.local', '.task', '.playwright-mcp', 'node_modules', 'dist',
                 'runtime', 'volumes', 'test-results', 'playwright-report', '__pycache__'}
PRIVATE_NAMES = {'PRIVATE.md', 'USAGE.md', 'secrets.env'}
REQUIRED = {'README.md', 'docs/release.md', 'docs/DEVELOPMENT.md', 'VERSION',
            'frontend/package.json', 'frontend/package-lock.json', 'packaging/build-release.py',
            'packaging/build-zip.py', 'packaging/source-allowlist.txt', 'packaging/release.json'}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sources() -> list[Path]:
    patterns = [s.strip() for s in (REPO / 'packaging/source-allowlist.txt').read_text().splitlines()
                if s.strip() and not s.lstrip().startswith('#')]
    selected = []
    for base, dirs, files in os.walk(REPO):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS and not (Path(base) / d).is_symlink())
        for name in sorted(files):
            path = Path(base) / name
            rel = path.relative_to(REPO)
            private = name in PRIVATE_NAMES or name.startswith('credentials') or (name.startswith('.env') and name != '.env.example')
            if private or not any(fnmatch.fnmatchcase(rel.as_posix(), p) for p in patterns):
                continue
            if path.is_symlink():
                raise RuntimeError(f'Symlink in source allowlist: {rel}')
            selected.append(rel)
    missing = REQUIRED - {p.as_posix() for p in selected}
    if missing:
        raise RuntimeError(f'Missing required source files: {sorted(missing)}')
    return sorted(selected)


def archive_sources(root: Path, selected: list[Path], version: str, epoch: int) -> Path:
    target = root / 'dist' / f'ModernUI-source-{version}.zip'
    target.parent.mkdir(exist_ok=True)
    stamp = time.gmtime(epoch)
    date = (*stamp[:5], stamp.tm_sec - stamp.tm_sec % 2)
    with zipfile.ZipFile(target, 'w') as archive:
        for rel in selected:
            info = zipfile.ZipInfo(f'ModernUI-source-{version}/{rel.as_posix()}', date)
            # Shell entrypoints need their executable bit after extracting without Git.
            executable = rel.suffix == '.sh'
            info.external_attr = (0o100755 if executable else 0o100644) << 16
            info.create_system = 3
            archive.writestr(info, (root / rel).read_bytes(), compress_type=zipfile.ZIP_DEFLATED,
                             compresslevel=9)
    return target


def report(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as z:
        entries = [(n, z.read(n)) for n in z.namelist()]
        if len(entries) != len(set(n for n, _ in entries)):
            raise RuntimeError('Duplicate archive paths')
    listing = '\n'.join(f'{digest(data)}  {len(data):>8}  {name}' for name, data in entries) + '\n'
    archive.with_suffix('.files.txt').write_text(listing, encoding='utf-8')
    sha = digest(archive.read_bytes())
    archive.with_suffix('.zip.sha256').write_text(f'{sha}  {archive.name}\n', encoding='utf-8')
    return {'name': archive.name, 'sha256': sha, 'bytes': archive.stat().st_size, 'files': len(entries)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=REPO / 'dist')
    args = parser.parse_args()
    config = json.loads((REPO / 'packaging/release.json').read_text())
    version = (REPO / 'VERSION').read_text().strip()
    if version != config['version'] or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise RuntimeError('VERSION must match packaging/release.json')
    epoch = config['sourceDateEpoch']
    if not isinstance(epoch, int) or epoch < 315532800:
        raise RuntimeError('Invalid sourceDateEpoch')
    selected = sources()
    inventory = {rel.as_posix(): digest((REPO / rel).read_bytes()) for rel in selected}
    args.out.mkdir(parents=True, exist_ok=True)
    results = []
    env = {**os.environ, 'SOURCE_DATE_EPOCH': str(epoch)}
    with tempfile.TemporaryDirectory(prefix='modernui-release-') as tmp:
        for attempt in (1, 2):
            root = Path(tmp) / str(attempt)
            root.mkdir()
            for rel in selected:
                target = root / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(REPO / rel, target)
                if digest(target.read_bytes()) != inventory[rel.as_posix()]:
                    raise RuntimeError(f'Source changed while copying: {rel}')
            print(f'release: independent build {attempt}, {len(selected)} allowlisted source files', flush=True)
            subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=root / 'frontend',
                           env=env, check=True)
            subprocess.run(['npm', 'run', 'build'], cwd=root / 'frontend', env=env, check=True)
            subprocess.run(['python3', 'packaging/build-zip.py'], cwd=root, env=env, check=True)
            source = archive_sources(root, selected, version, epoch)
            install = root / 'dist' / f'ModernUI-{version}.zip'
            results.append({'install': report(install), 'source': report(source)})
        if results[0] != results[1]:
            raise RuntimeError('Independent builds differ; release has not passed reproduction')
        current = {rel.as_posix(): digest((REPO / rel).read_bytes()) for rel in sources()}
        if current != inventory:
            raise RuntimeError('Source tree changed during release build')
        for artifact in (Path(tmp) / '1' / 'dist').iterdir():
            shutil.copy2(artifact, args.out / artifact.name)
    evidence = {'version': version, 'sourceDateEpoch': epoch, 'reproducible': True,
                'python': sys.version.split()[0], 'zlib': zlib.ZLIB_RUNTIME_VERSION,
                'node': subprocess.check_output(['node', '--version'], text=True).strip(),
                'npm': subprocess.check_output(['npm', '--version'], text=True).strip(),
                'lockfileSha256': inventory['frontend/package-lock.json'], 'builds': results}
    (args.out / f'ModernUI-{version}.build.json').write_text(json.dumps(evidence, indent=2) + '\n')
    sums = ''.join(f"{item['sha256']}  {item['name']}\n" for item in results[0].values())
    (args.out / f'ModernUI-{version}.SHA256SUMS').write_text(sums)
    print(sums, end='')
    print('release: both complete ZIPs are byte-identical across independent builds')


if __name__ == '__main__':
    main()
