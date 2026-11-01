#!/usr/bin/env python3
"""Builds the installable ModernUI ZIP (task package).

    packaging/build-zip.py [--version X.Y.Z] [--out dist]

* Files come from src/ through packaging/allowlist.txt only; hashed frontend files only when the current
  dist/manifest.json refers to them (older builds kept for open pages are not packed).
* ZIP paths follow vtlib PackageImport::initImport() of Vtiger 8.4.0: the runtime path of every file after the
  import is computed with the same include list and rename rules and must equal its path in src/.
* Checks: no source maps, no other "manifest?xml" names (checkZip() matches /manifest.xml/ anywhere), no
  dev-server URLs or absolute machine paths, PHP only under modules/ and languages/.
* Reproducible: sorted entries, fixed timestamps (SOURCE_DATE_EPOCH or the last commit), fixed permissions.
* Writes dist/ModernUI-<version>.zip, .zip.sha256 (sha256sum format) and .files.txt (path, size, SHA-256).
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / 'src'
MODULE = 'ModernUI'
DIST_DIR = 'layouts/v7/modules/ModernUI/resources/dist'
REQUIRED_ENTRIES = ('src/shell/main.ts', 'src/settings/main.ts', 'src/skin/skin.scss')

# vtlib/Vtiger/PackageImport.php (8.4.0) initImport(): include prefixes and rename map, in this order.
IMPORT_INCLUDE = ['templates', f'modules/{MODULE}', 'cron', 'languages', 'settings', 'settings/actions',
                  'settings/views', 'settings/models', 'settings/templates', 'settings/connectors',
                  'settings/libraries', 'settings/handlers', f'{MODULE}.png', 'images', 'layouts']
IMPORT_RENAME = [
    ('templates', f'layouts/vlayout/modules/{MODULE}'),
    ('cron', f'cron/modules/{MODULE}'),
    ('settings/actions', f'modules/Settings/{MODULE}/actions'),
    ('settings/views', f'modules/Settings/{MODULE}/views'),
    ('settings/models', f'modules/Settings/{MODULE}/models'),
    ('settings/connectors', f'modules/Settings/{MODULE}/connectors'),
    ('settings/libraries', f'modules/Settings/{MODULE}/libraries'),
    ('settings/handlers', f'modules/Settings/{MODULE}/handlers'),
    ('settings/templates', f'layouts/vlayout/modules/Settings/{MODULE}'),
    ('images', f'layouts/vlayout/skins/images/{MODULE}'),
    ('settings', 'modules/Settings'),
    ('layouts', 'layouts'),
]
# PackageUpdate::initUpdate() has no settings/handlers in its include list: ModernUI must not use it.
UPDATE_INCLUDE = ['templates', f'modules/{MODULE}', 'cron', 'languages', 'settings', 'settings/actions',
                  'settings/views', 'settings/models', 'settings/templates', 'settings/connectors',
                  'settings/libraries', 'images', 'layouts']

TEXT_SUFFIXES = {'.php', '.tpl', '.js', '.css', '.json', '.txt', '.xml'}
FORBIDDEN_CONTENT = [
    (re.compile(r'localhost|127\.0\.0\.1|:5173\b|/@vite/client|@vite/env'), 'dev server URL'),
    (re.compile(r'(?<![A-Za-z0-9_.-])/(home|Users|root|var/www|srv|opt)/[A-Za-z0-9_.-]+/'), 'absolute machine path'),
    (re.compile(r'file://'), 'file URL'),
    (re.compile(r'sourceMappingURL'), 'source map reference'),
]


class PackageError(Exception):
    pass


def import_target(zip_path: str, include: list[str]) -> str | None:
    """Runtime path of a ZIP file after Vtiger_Unzip::unzipAllEx() (prefix match without separators, as PHP)."""
    if not any(zip_path.startswith(prefix) for prefix in include):
        return None
    dirname, _, name = zip_path.rpartition('/')
    for lookup, replace in IMPORT_RENAME:
        if dirname.startswith(lookup):
            dirname = replace + dirname[len(lookup):]
            break
    return f'{dirname}/{name}' if dirname else name


def zip_path_of(src_path: str) -> str:
    prefix = f'modules/Settings/{MODULE}/'
    if src_path.startswith(prefix):
        rest = src_path[len(prefix):]
        if rest.split('/', 1)[0] not in ('actions', 'views', 'models'):
            raise PackageError(f'{src_path}: only actions/, views/ and models/ of the settings module can be packed')
        return f'settings/{rest}'
    return src_path


def matches(path: str, pattern: str) -> bool:
    path_parts, pattern_parts = path.split('/'), pattern.split('/')
    return len(path_parts) == len(pattern_parts) and all(fnmatch.fnmatchcase(p, q) for p, q in zip(path_parts, pattern_parts))


def read_allowlist() -> list[str]:
    lines = (REPO / 'packaging' / 'allowlist.txt').read_text(encoding='utf-8').splitlines()
    return [line.strip() for line in lines if line.strip() and not line.lstrip().startswith('#')]


def manifest_files(manifest: dict) -> set[str]:
    files: set[str] = set()
    for chunk in manifest.values():
        if not isinstance(chunk, dict):
            continue
        if isinstance(chunk.get('file'), str):
            files.add(chunk['file'])
        for key in ('css', 'assets'):
            for item in chunk.get(key) or []:
                if isinstance(item, str):
                    files.add(item)
    return files


def collect() -> list[str]:
    manifest_path = SRC / DIST_DIR / 'manifest.json'
    if not manifest_path.is_file():
        raise PackageError(f'{DIST_DIR}/manifest.json is missing: run task build first')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for entry in REQUIRED_ENTRIES:
        if not isinstance(manifest.get(entry), dict) or not isinstance(manifest[entry].get('file'), str):
            raise PackageError(f'the frontend manifest has no entry {entry}')
    referenced = {f'{DIST_DIR}/{name}' for name in manifest_files(manifest)}
    for path in sorted(referenced):
        if not (SRC / path).is_file():
            raise PackageError(f'{path} is referenced by the manifest but missing')

    patterns = read_allowlist()
    selected: list[str] = []
    for file in sorted(SRC.rglob('*')):
        if not file.is_file() or file.is_symlink():
            continue
        rel = file.relative_to(SRC).as_posix()
        if not any(matches(rel, pattern) for pattern in patterns):
            continue
        if rel.startswith(f'{DIST_DIR}/assets/') and rel not in referenced:
            continue  # an older build kept for pages that are still open
        selected.append(rel)
    missing = [path for path in referenced if path not in selected]
    if missing:
        raise PackageError(f'manifest files outside the allowlist: {missing}')
    return selected


def check(src_paths: list[str]) -> None:
    for rel in src_paths:
        zip_path = zip_path_of(rel)
        if rel.endswith('.map'):
            raise PackageError(f'{rel}: source maps are not shipped')
        if re.search(r'manifest.xml', zip_path):
            raise PackageError(f'{rel}: checkZip() of vtlib would take it for the module manifest')
        if rel.endswith('.php') and not (rel.startswith('modules/') or rel.startswith('languages/')):
            raise PackageError(f'{rel}: PHP outside modules/ and languages/')
        for include, kind in ((IMPORT_INCLUDE, 'import'), (UPDATE_INCLUDE, 'update')):
            target = import_target(zip_path, include)
            if target != rel:
                raise PackageError(f'{zip_path}: vtlib {kind} would put it at {target!r}, ModernUI expects {rel!r}')
        if Path(rel).suffix in TEXT_SUFFIXES:
            text = (SRC / rel).read_text(encoding='utf-8')
            for pattern, what in FORBIDDEN_CONTENT:
                found = pattern.search(text)
                if found:
                    raise PackageError(f'{rel}: {what} ({found.group(0)!r})')


def build_time() -> tuple[int, int, int, int, int, int]:
    epoch = os.environ.get('SOURCE_DATE_EPOCH')
    if not epoch:
        try:
            epoch = subprocess.run(['git', '-C', str(REPO), 'log', '-1', '--format=%ct'], check=True,
                                   capture_output=True, text=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            epoch = ''
    stamp = time.gmtime(int(epoch)) if epoch.isdigit() else time.gmtime(315532800)  # 1980-01-01
    return (max(stamp.tm_year, 1980), stamp.tm_mon, stamp.tm_mday, stamp.tm_hour, stamp.tm_min, stamp.tm_sec - stamp.tm_sec % 2)


def write_zip(version: str, src_paths: list[str], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f'{MODULE}-{version}.zip'
    temp = target.with_suffix('.zip.tmp')
    date_time = build_time()
    manifest_xml = (REPO / 'packaging' / 'manifest.xml.tpl').read_text(encoding='utf-8').replace('@VERSION@', version)
    entries: list[tuple[str, bytes]] = [('manifest.xml', manifest_xml.encode('utf-8'))]
    entries += [(zip_path_of(rel), (SRC / rel).read_bytes()) for rel in src_paths]
    entries.sort(key=lambda item: (item[0] != 'manifest.xml', item[0]))
    with zipfile.ZipFile(temp, 'w') as archive:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=date_time)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            info.create_system = 3
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    temp.replace(target)

    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (out_dir / f'{target.name}.sha256').write_text(f'{digest}  {target.name}\n', encoding='utf-8')
    listing = [f'{hashlib.sha256(data).hexdigest()}  {len(data):>8}  {name}' for name, data in entries]
    (out_dir / f'{MODULE}-{version}.files.txt').write_text('\n'.join(listing) + '\n', encoding='utf-8')
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--version', default=os.environ.get('MU_VERSION') or (REPO / 'VERSION').read_text(encoding='utf-8').strip())
    parser.add_argument('--out', default=str(REPO / 'dist'))
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        print(f'package: bad version {args.version!r}', file=sys.stderr)
        return 1
    try:
        files = collect()
        check(files)
        target = write_zip(args.version, files, Path(args.out))
    except PackageError as error:
        print(f'package: {error}', file=sys.stderr)
        return 1
    digest = (Path(args.out) / f'{target.name}.sha256').read_text(encoding='utf-8').split()[0]
    print(f'package: {target.relative_to(REPO) if target.is_relative_to(REPO) else target}')
    print(f'package: {len(files) + 1} files, {target.stat().st_size} bytes, version {args.version}')
    print(f'package: SHA-256 {digest}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
