"""Negative controls for the clean-instance regression gate, not screenshots of application implementations."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

SCRIPT = Path(__file__).resolve().parents[1] / 'dev/visual/regression.py'
spec = importlib.util.spec_from_file_location('visual_regression', SCRIPT)
regression = importlib.util.module_from_spec(spec)
spec.loader.exec_module(regression)


class RegressionTest(unittest.TestCase):
    def gate(self, mutation):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline, candidate = root / 'baseline', root / 'candidate'
            baseline.mkdir()
            candidate.mkdir()
            (baseline / 'manifest.json').write_text(json.dumps({'threshold': {'channelDelta': 16, 'pixelRatio': 0.005}}))
            data = {'scene': {'box': {'x': 24, 'y': 96, 'width': 100, 'height': 100},
                              'viewport': {'width': 1440, 'height': 1000}, 'locale': 'en-US', 'masks': []}}
            for folder in (baseline, candidate):
                (folder / 'measurements.json').write_text(json.dumps(data))
                Image.new('RGB', (100, 100), 'white').save(folder / 'scene.png')
            mutation(candidate)
            return regression.check(baseline, candidate, root / 'result', [{'id': 'scene'}])

    def test_noise_floor(self):
        def noise(candidate):
            Image.new('RGB', (100, 100), (240, 240, 240)).save(candidate / 'scene.png')
        self.assertEqual(self.gate(noise), 0)

    def test_changed_surface_blocks(self):
        def defect(candidate):
            image = Image.new('RGB', (100, 100), 'white')
            ImageDraw.Draw(image).rectangle((0, 0, 15, 15), fill='blue')
            image.save(candidate / 'scene.png')
        self.assertEqual(self.gate(defect), 1)

    def test_moved_region_blocks_even_with_identical_crop(self):
        def move(candidate):
            file = candidate / 'measurements.json'
            data = json.loads(file.read_text())
            data['scene']['box']['y'] += 3
            file.write_text(json.dumps(data))
        self.assertEqual(self.gate(move), 1)

    def test_missing_image_blocks(self):
        self.assertEqual(self.gate(lambda candidate: (candidate / 'scene.png').unlink()), 1)

    def test_browser_change_requires_review(self):
        def update(candidate):
            manifest = candidate.parent / 'baseline' / 'manifest.json'
            data = json.loads(manifest.read_text())
            data['browser'] = '153.0.0.0'
            manifest.write_text(json.dumps(data))
            (candidate / 'runtime.json').write_text(json.dumps({'browser': '154.0.0.0'}))
        with self.assertRaisesRegex(ValueError, 'browser version changed'):
            self.gate(update)


if __name__ == '__main__':
    unittest.main()
