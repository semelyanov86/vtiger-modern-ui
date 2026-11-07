#!/usr/bin/env python3
"""Checks of the installable ZIP (task test:package).

* reproducible: two builds of the same tree give byte-identical archives;
* manifest.xml is what checkZip() of vtlib accepts (extension, vtiger_version, no <customlinks>/<tables>);
* only own files: allowlisted paths, no sources, maps, node_modules, environment or private files;
* every hashed file of the frontend manifest is inside, nothing else from the build directory;
* the real importer of the official Vtiger 8.4.0 sources (VTIGER_SRC_REPO: a git checkout with tag 8.4.0)
  unpacks every file to the path ModernUI expects, for import and for update.

Needs a production build (task build). Writes only to a temporary directory.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ElementTree
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ with machine paths next to packaging/build-zip.py
REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('build_zip', REPO / 'packaging' / 'build-zip.py')
assert spec and spec.loader
build_zip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_zip)

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(message)
        print(f'FAIL {message}', file=sys.stderr)


def build(out: Path) -> Path:
    env = dict(os.environ, SOURCE_DATE_EPOCH='1793530000')
    result = subprocess.run([sys.executable, str(REPO / 'packaging' / 'build-zip.py'), '--version', '9.9.9', '--out', str(out)],
                            capture_output=True, text=True, env=env)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    return out / 'ModernUI-9.9.9.zip'


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='mu-package-') as temp:
        first = build(Path(temp) / 'a')
        second = build(Path(temp) / 'b')
        digest = hashlib.sha256(first.read_bytes()).hexdigest()
        check(digest == hashlib.sha256(second.read_bytes()).hexdigest(), 'two builds of the same tree are byte-identical')
        sha_line = (first.parent / f'{first.name}.sha256').read_text(encoding='utf-8')
        check(sha_line == f'{digest}  {first.name}\n', 'the .sha256 file matches the archive')

        with zipfile.ZipFile(first) as archive:
            names = archive.namelist()
            check(names[0] == 'manifest.xml', 'manifest.xml is the first entry')
            check(len(names) == len(set(names)), 'no duplicate entries')
            check(len({info.date_time for info in archive.infolist()}) == 1, 'one fixed timestamp for all entries')
            manifest = ElementTree.fromstring(archive.read('manifest.xml'))
            check(manifest.findtext('name') == 'ModernUI' and manifest.findtext('type') == 'extension', 'manifest: ModernUI extension')
            check(manifest.findtext('version') == '9.9.9', 'manifest: version from the build')
            check(manifest.findtext('dependencies/vtiger_version') == '8.4.0', 'manifest: vtiger_version 8.4.0 (checkZip needs >= 6.0.0rc)')
            check(manifest.findtext('dependencies/vtiger_max_version') == '8.4.*', 'manifest: vtiger_max_version 8.4.*')
            for tag in ('customlinks', 'tables', 'events', 'crons', 'parent/x'):
                check(manifest.find(tag) is None, f'manifest: no <{tag}> (links and tables come from the lifecycle)')

            allowed_prefixes = ('modules/ModernUI/', 'settings/actions/', 'settings/views/', 'settings/models/',
                                'layouts/v7/modules/ModernUI/', 'layouts/v7/modules/Settings/ModernUI/', 'languages/')
            for name in names[1:]:
                check(name.startswith(allowed_prefixes), f'{name}: inside the paths of the module')
                check(not any(part.startswith('.') for part in name.split('/')), f'{name}: no hidden files')
                check(Path(name).suffix in {'.php', '.tpl', '.js', '.css', '.json', '.txt', '.woff2'}, f'{name}: allowed file type')
                check('node_modules' not in name and not name.endswith(('.map', '.ts', '.vue', '.scss')), f'{name}: no sources or maps')
                for forbidden in ('.env', 'PRIVATE', 'USAGE', 'dev/', 'tests/', 'frontend/'):
                    check(forbidden not in name, f'{name}: not a development file ({forbidden})')
            for language in ('en_us', 'ru_ru', 'de_de'):
                for module in ('ModernUI', 'Settings/ModernUI'):
                    check(f'languages/{language}/{module}.php' in names, f'language file {language}/{module}')

            dist = 'layouts/v7/modules/ModernUI/resources/dist/'
            frontend_manifest = json.loads(archive.read(dist + 'manifest.json'))
            referenced = {dist + file for file in build_zip.manifest_files(frontend_manifest)}
            packed_assets = {name for name in names if name.startswith(dist + 'assets/')}
            check(referenced == packed_assets, 'exactly the files of the frontend manifest are packed')
            licences = archive.read(dist + 'THIRD_PARTY_LICENSES.txt').decode('utf-8')
            for package in ('vue ', 'reka-ui ', 'vue-i18n ', '@lucide/vue ', '@fontsource/poppins ', '@fontsource/arimo ', '@fontsource-variable/inter '):
                check(f'\n{package}' in licences, f'licence text of {package.strip()}')
            check(first.stat().st_size < 2_000_000, f'archive size {first.stat().st_size} bytes')

        vtiger_repo = os.environ.get('VTIGER_SRC_REPO', '')
        if not vtiger_repo:
            print('SKIPPED real-importer check: set VTIGER_SRC_REPO to a git checkout of the official Vtiger repository', file=sys.stderr)
            failures.append('real-importer check skipped')
        else:
            sources = Path(temp) / 'vtiger-8.4.0'
            sources.mkdir()
            archive_cmd = subprocess.run(['git', '-C', vtiger_repo, 'archive', '8.4.0', 'vtlib', 'includes', 'include'], capture_output=True, check=True)
            subprocess.run(['tar', '-x', '-C', str(sources)], input=archive_cmd.stdout, check=True)
            expected = sorted(build_zip.import_target(name, build_zip.IMPORT_INCLUDE) or '' for name in names[1:])
            for mode in ('import', 'update'):
                target = Path(temp) / f'unpacked-{mode}'
                target.mkdir()
                result = subprocess.run([os.environ.get('MU_TEST_PHP', 'php8.5'), str(REPO / 'tests/package/vtlib-unzip.php'), str(sources), str(first), str(target), mode],
                                        capture_output=True, text=True)
                check(result.returncode == 0, f'vtlib {mode}: {result.stderr.strip()}')
                unpacked = sorted(line for line in result.stdout.splitlines() if line)
                check(unpacked == expected, f'vtlib {mode} of 8.4.0 puts every file where ModernUI expects it')
                src_paths = sorted(name if not name.startswith('settings/') else 'modules/Settings/ModernUI/' + name[len('settings/'):] for name in names[1:])
                check(unpacked == src_paths, f'vtlib {mode}: runtime paths equal the paths in src/ (dev link map)')

    print(f'package: {checks} check(s), {len(failures)} failed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
