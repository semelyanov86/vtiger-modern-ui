#!/usr/bin/env python3
"""Compare clean-instance captures with reviewed ModernUI images. This tool never writes to the baseline."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops


def pixels(first, second, channel_delta=16):
    """Count pixels whose largest RGB channel difference exceeds the calibrated noise floor."""
    a, b = first.convert('RGB'), second.convert('RGB')
    if a.size != b.size:
        return None, None
    diff = ImageChops.difference(a, b)
    changed = sum(max(pixel) > channel_delta for pixel in diff.getdata())
    return changed / (a.width * a.height), diff


def check(baseline, candidate, out, scenes):
    accepted = json.loads((baseline / 'manifest.json').read_text())
    if accepted.get('browser') is not None:
        runtime = json.loads((candidate / 'runtime.json').read_text())
        if runtime.get('browser') != accepted['browser']:
            raise ValueError('browser version changed: review captures before accepting a new runtime')
    before = json.loads((baseline / 'measurements.json').read_text())
    after = json.loads((candidate / 'measurements.json').read_text())
    ids = [scene['id'] for scene in scenes]
    if sorted(ids) != sorted(before) or sorted(ids) != sorted(after):
        raise ValueError('scene inventory differs: missing or extra captures must be reviewed')
    threshold = accepted['threshold']
    # The documented maximum cannot be relaxed by a candidate or accidentally widened in the manifest.
    if not (0 <= threshold['pixelRatio'] <= 0.005 and 0 <= threshold['channelDelta'] <= 16):
        raise ValueError('threshold exceeds the visual contract')
    out.mkdir(parents=True, exist_ok=True)
    report = []
    for name in ids:
        reasons = []
        if before[name]['viewport'] != after[name]['viewport'] or before[name]['locale'] != after[name]['locale']:
            reasons.append('viewport or locale changed')
        if before[name].get('masks') != [] or after[name].get('masks') != []:
            reasons.append('unreviewed mask')
        for axis in ('x', 'y', 'width', 'height'):
            if abs(before[name]['box'][axis] - after[name]['box'][axis]) > 0.5:
                reasons.append(f'region {axis} changed')
        ratio = None
        try:
            with Image.open(baseline / (name + '.png')) as first, Image.open(candidate / (name + '.png')) as second:
                ratio, diff = pixels(first, second, threshold['channelDelta'])
                if ratio is None:
                    reasons.append('image dimensions changed')
                elif ratio > threshold['pixelRatio']:
                    reasons.append('pixels exceed calibrated tolerance')
                if reasons and diff is not None:
                    diff.save(out / (name + '-diff.png'))
        except (FileNotFoundError, OSError) as error:
            reasons.append(type(error).__name__ + ': image is missing or invalid')
        report.append({'id': name, 'changedRatio': ratio, 'result': 'FAIL' if reasons else 'PASS', 'reasons': reasons})
    (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    for row in report:
        ratio = 'n/a' if row['changedRatio'] is None else f"{row['changedRatio']:.6%}"
        print(row['result'], row['id'], ratio, '; '.join(row['reasons']))
    return 1 if any(row['reasons'] for row in report) else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, default=Path('tests/visual/accepted'))
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--scenes', type=Path, default=Path('dev/visual/regression.json'))
    args = parser.parse_args()
    try:
        return check(args.baseline, args.candidate, args.out or args.candidate / 'compare', json.loads(args.scenes.read_text()))
    except (KeyError, ValueError, OSError) as error:
        print('FAIL:', str(error))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
