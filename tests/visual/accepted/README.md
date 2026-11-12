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
