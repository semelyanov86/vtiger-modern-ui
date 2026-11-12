# Accepted ModernUI appearance

These 50 images contain only the synthetic data from the native clean-instance seed. They were
reviewed after the cloud comparison in [the acceptance report](../../../docs/visual-acceptance.md).
Cloud and development-instance screenshots are never stored here.

`manifest.json` pins the reviewed package, browser, environment and measured noise. The calibrated
limit is 0.1% of pixels with an RGB channel difference above 16; observed noise was at most
0.082816%, on the back arrow only. Region positions and dimensions are also checked independently.
There are no masks. The capture requires two consecutive identical frames.

Run `MU_E2E_TARGET=c81 task visual:regression` (capture and compare), then
repeat for `c85`, after importing one package into both fresh seeded instances. The baseline is
never changed by the command. `task visual:capture` captures candidates for inspection only. A deliberate update requires cloud comparison, visual review,
noise calibration and a reviewable replacement of these files. Keep browser and OS versions aligned
with the manifest; browser updates require review.

The accepted system fonts are Arial regular/bold (`ttf-mscorefonts-installer`) and Noto Sans
regular/bold (`fonts-noto-core`, the Segoe UI fallback). CI installs them; `dev/visual/check-fonts.py`
checks resolved families and font-file hashes before capture. These system fonts are not distributed
in the module or this repository. Bundled Arimo remains the product fallback when Arial is absent;
switching to that face is a different screenshot environment, not rasterization noise.

`dev/visual/fontconfig.conf` pins Noto Sans Math (also in `fonts-noto-core`) after Arial/Noto Sans
for missing symbols. The capture browser alone uses this configuration; the product's CSS and system
configuration are unchanged. Its font hash and the U+2197 fallback choice are checked before capture.
Only the seven pinned system faces are exposed to this browser process; the preflight rejects any
other font file. The remaining two faces are Courier New bold for FullCalendar arrows and
DejaVu Sans Mono (`fonts-dejavu-core`) for color values. CDP also verifies the actual fonts of
record and calendar arrows against `platformFonts`.
