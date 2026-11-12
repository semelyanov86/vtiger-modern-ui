#!/usr/bin/env python3
"""Pairs and geometry table: ModernUI against the pinned cloud reference (docs/visual-parity.md §3, §5).

Local tool of the stage 09 contract, no access to the cloud and nothing of it in CI. The reference (cloud screenshots,
measurements.json, manifest) and the screens of a dev instance stay in the private directory of PRIVATE.md.

    python3 dev/visual/compare.py --reference <dir of the cloud reference> --candidate <dir of task visual:pairs> [--out <dir>]
    python3 dev/visual/compare.py --noise a.png b.png [c.png d.png ...]

The table compares the elements of dev/visual/states.json: geometry with the tolerances of the contract (sizes ±2 px,
positions ±4 px; the cloud box is moved up by the excluded trial banner where the state says so) and computed styles
exactly. Pairs are side-by-side images (cloud | ModernUI) for the visual review by large regions; no global similarity
percentage is computed. --noise measures the noise of repeated screenshots of the same reference state (the threshold of
pixel comparisons of deterministic regions). Exit code 1 when a compared value is out of tolerance.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def union(boxes):
    x1 = min(box[0] for box in boxes)
    y1 = min(box[1] for box in boxes)
    x2 = max(box[0] + box[2] for box in boxes)
    y2 = max(box[1] + box[3] for box in boxes)
    return [x1, y1, x2 - x1, y2 - y1]


def noise(paths):
    from PIL import Image, ImageChops
    rows = []
    for first, second in zip(paths[0::2], paths[1::2]):
        a = Image.open(first).convert('RGB')
        b = Image.open(second).convert('RGB')
        if a.size != b.size:
            rows.append((first, second, 'size differs', a.size, b.size))
            continue
        diff = ImageChops.difference(a, b)
        pixels = a.size[0] * a.size[1]
        changed = sum(1 for p in diff.getdata() if max(p) > 0)
        changed16 = sum(1 for p in diff.getdata() if max(p) > 16)
        rows.append((os.path.basename(first), os.path.basename(second), changed, changed16, pixels, diff.getbbox()))
    for row in rows:
        print('noise', *row)
    return rows


def pair(reference, candidate, out):
    from PIL import Image
    a = Image.open(reference).convert('RGB')
    b = Image.open(candidate).convert('RGB')
    height = max(a.size[1], b.size[1])
    sheet = Image.new('RGB', (a.size[0] + b.size[0] + 16, height), (255, 255, 255))
    sheet.paste(a, (0, 0))
    sheet.paste(b, (a.size[0] + 16, 0))
    sheet.save(out)


def region_images(reference, candidate, ref_box, cand_box, out):
    """Compare a named region without scaling, masking text, or producing a misleading cross-product score."""
    from PIL import Image, ImageChops
    import math

    def crop(path, box):
        x, y, w, h = box
        if w <= 0 or h <= 0:
            raise ValueError('a compared region has no visible area')
        return Image.open(path).convert('RGB').crop((math.floor(x), math.floor(y), math.ceil(x + w), math.ceil(y + h)))

    a, b = crop(reference, ref_box), crop(candidate, cand_box)
    size = max(a.width, b.width), max(a.height, b.height)
    # Unequal extents remain visible; fitting one image to the other would hide geometry defects.
    canvases = []
    for image in (a, b):
        canvas = Image.new('RGB', size, '#ff00ff')
        canvas.paste(image, (0, 0))
        canvases.append(canvas)
    Image.blend(*canvases, 0.5).save(out + '-overlay.png')
    ImageChops.difference(*canvases).save(out + '-diff.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--reference', help='directory of the cloud reference (measurements.json and screenshots)')
    parser.add_argument('--candidate', help='directory written by task visual:pairs (measurements.json, <state>.png)')
    parser.add_argument('--states', default=os.path.join(HERE, 'states.json'))
    parser.add_argument('--out', help='where pairs and geometry.md go (default: <candidate>/compare)')
    parser.add_argument('--noise', nargs='+', help='pairs of screenshots of the same reference state')
    args = parser.parse_args()
    if args.noise:
        noise(args.noise)
        return 0
    if not args.reference or not args.candidate:
        parser.error('--reference and --candidate are required')
    spec = load(args.states)
    reference = load(os.path.join(args.reference, 'measurements.json'))
    candidate = load(os.path.join(args.candidate, 'measurements.json'))
    out = args.out or os.path.join(args.candidate, 'compare')
    os.makedirs(out, exist_ok=True)
    tolerance = spec['tolerance']
    banner = spec.get('banner', 0)
    lines = ['| State | Element | Check | Cloud | ModernUI | Δ / tolerance | Result |', '|---|---|---|---|---|---|---|']
    regions = []
    failures = 0
    for state in spec['states']:
        ref_state = reference.get(state['reference'], {}).get('items', {})
        cand_state = candidate.get(state['id'], {}).get('items', {})
        shot_ref = os.path.join(args.reference, state.get('screenshot', ''))
        shot_cand = os.path.join(args.candidate, state['id'] + '.png')
        if os.path.isfile(shot_ref) and os.path.isfile(shot_cand):
            pair(shot_ref, shot_cand, os.path.join(out, state['id'] + '-pair.png'))
        else:
            lines.append(f"| {state['id']} | screenshot | — | {os.path.isfile(shot_ref)} | {os.path.isfile(shot_cand)} | required | FAIL |")
            failures += 1
        for element_id, element in state['elements'].items():
            refs = [ref_state.get(name) for name in element['ref']]
            cand = cand_state.get(element_id)
            if any(item is None or item.get('missing') for item in refs):
                lines.append(f"| {state['id']} | {element_id} | — | not measured | | | NO REFERENCE |")
                failures += 1
                continue
            if cand is None or cand.get('missing'):
                lines.append(f"| {state['id']} | {element_id} | — | | missing | | FAIL |")
                failures += 1
                continue
            box = union([item['box'] for item in refs])
            if element_id in state.get('regions', []) and os.path.isfile(shot_ref) and os.path.isfile(shot_cand):
                prefix = os.path.join(out, state['id'] + '-' + element_id)
                region_images(shot_ref, shot_cand, box, cand['box'], prefix)
                regions.append({'state': state['id'], 'element': element_id, 'referenceBox': box,
                                'candidateBox': cand['box'], 'masks': [], 'rescaled': False,
                                'pixelScore': None, 'reason': 'Different CRM data; inspect images and geometry separately.'})
            if element.get('shift'):
                box = [box[0], box[1] - banner, box[2], box[3]]
            for check in element.get('check', []):
                if check in ('cx', 'cy'):
                    index = 'xy'.index(check[1])
                    expected = box[index] + box[index + 2] / 2
                    actual = cand['box'][index] + cand['box'][index + 2] / 2
                else:
                    index = 'xywh'.index(check)
                    expected, actual = box[index], cand['box'][index]
                limit = tolerance['position'] if check in ('x', 'y', 'cx', 'cy') else tolerance['size']
                delta = actual - expected
                ok = abs(delta) <= limit
                failures += 0 if ok else 1
                lines.append(f"| {state['id']} | {element_id} | {check} | {expected:g} | {actual:g} | {delta:+g} / ±{limit} | {'PASS' if ok else 'FAIL'} |")
            first = refs[0]
            for style in element.get('styles', []):
                ok = style in first and style in cand and first[style] == cand[style]
                failures += 0 if ok else 1
                lines.append(f"| {state['id']} | {element_id} | {style} | {first.get(style)} | {cand.get(style)} | exact | {'PASS' if ok else 'FAIL'} |")
    with open(os.path.join(out, 'geometry.md'), 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(lines) + '\n')
    with open(os.path.join(out, 'regions.json'), 'w', encoding='utf-8') as handle:
        json.dump(regions, handle, indent=2)
        handle.write('\n')
    print('\n'.join(lines))
    print(f'{failures} value(s) out of tolerance; pairs and geometry.md in {out}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
