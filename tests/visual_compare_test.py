"""The visual gate must fail closed and must not fit mismatched geometry to its reference."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / 'dev/visual/compare.py'
spec = importlib.util.spec_from_file_location('visual_compare', SCRIPT)
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


class CompareTest(unittest.TestCase):
    def run_gate(self, missing=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference, candidate = root / 'reference', root / 'candidate'
            reference.mkdir()
            candidate.mkdir()
            state = {'box': [0, 0, 20, 10], 'bg': 'rgb(255, 255, 255)'}
            ref = {} if missing == 'reference' else {'surface': state.copy()}
            cand = {} if missing == 'candidate' else {'surface': state.copy()}
            if missing == 'style':
                del ref['surface']['bg']
                del cand['surface']['bg']
            (reference / 'measurements.json').write_text(json.dumps({'sample': {'items': ref}}))
            (candidate / 'measurements.json').write_text(json.dumps({'sample': {'items': cand}}))
            for folder in (reference, candidate):
                if missing != 'screenshot' or folder != candidate:
                    Image.new('RGB', (20, 10), 'white').save(folder / 'sample.png')
            states = {'tolerance': {'position': 4, 'size': 2}, 'states': [{
                'id': 'sample', 'reference': 'sample', 'screenshot': 'sample.png',
                'elements': {'surface': {'ref': ['surface'], 'check': ['w', 'h'], 'styles': ['bg']}},
            }]}
            (root / 'states.json').write_text(json.dumps(states))
            result = subprocess.run(['python3', str(SCRIPT), '--reference', str(reference),
                                     '--candidate', str(candidate), '--states', str(root / 'states.json')],
                                    capture_output=True, text=True, check=False)
            return result.returncode

    def test_identical_measurements_pass(self):
        self.assertEqual(self.run_gate(), 0)

    def test_missing_evidence_fails(self):
        for missing in ('reference', 'candidate', 'screenshot', 'style'):
            with self.subTest(missing=missing):
                self.assertEqual(self.run_gate(missing), 1)

    def test_regions_keep_unequal_extents_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, size in [('a', (20, 10)), ('b', (30, 12))]:
                Image.new('RGB', size, 'white').save(root / (name + '.png'))
            compare.region_images(root / 'a.png', root / 'b.png', [0, 0, 20, 10], [0, 0, 30, 12], str(root / 'region'))
            with Image.open(root / 'region-diff.png') as diff:
                self.assertEqual(diff.size, (30, 12))
                self.assertEqual(diff.getpixel((5, 5)), (0, 0, 0))
                self.assertNotEqual(diff.getpixel((25, 5)), (0, 0, 0))


if __name__ == '__main__':
    unittest.main()
