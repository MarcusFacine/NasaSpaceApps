# Regolith detail texture for the ground shader (dist/lunar-surface.js): one periodic tile, used at four scales.
# R,G: surface slope dh/du, dh/dv (tile units) mapped to 0..255 around 128 with SLOPE_RANGE; B: height 0..255.
# Content, after Apollo surface photography and the regolith literature (Heiken et al., Lunar Sourcebook ch. 7):
#  - self-affine relief, Hurst exponent ~0.8 (surface power spectrum ~ f^-(2H+2));
#  - a size-frequency population of small degraded craters (bowls with low, broad rims), a few fresher ones;
#  - clods and pebbles: cumulative N(>D) ~ D^-2.2, angular, partly buried.
# python scripts/make-regolith.py  ->  dist/assets/regolith/regolith.webp (lossless)
import numpy as np
from PIL import Image
N, SLOPE_RANGE, H = 1024, 3.0, 0.8
rng = np.random.default_rng(20261116)
f = np.fft.fftfreq(N)[:, None], np.fft.fftfreq(N)[None, :]
k = np.sqrt(f[0] ** 2 + f[1] ** 2); k[0, 0] = 1
spec = (rng.normal(size=(N, N)) + 1j * rng.normal(size=(N, N))) * k ** (-(2 * H + 2) / 2) * np.exp(-(k * N / 90) ** 2)   # grains below ~10 px are the clods' job
spec[0, 0] = 0
base = np.real(np.fft.ifft2(spec)); base *= 0.0045 / base.std()   # RMS height 0.45 % of the tile
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
h = base.astype(np.float32)

def stamp(cx, cy, r, fn):
    # Periodic stamp: evaluate fn(rho, dx, dy) on the wrapped window around (cx, cy).
    R = int(np.ceil(r * 2.6)) + 2
    xs = (np.arange(int(cx) - R, int(cx) + R + 1)) % N; ys = (np.arange(int(cy) - R, int(cy) + R + 1)) % N
    dx = (np.arange(int(cx) - R, int(cx) + R + 1) - cx)[None, :]; dy = (np.arange(int(cy) - R, int(cy) + R + 1) - cy)[:, None]
    h[np.ix_(ys, xs)] += fn(np.sqrt(dx * dx + dy * dy) / r, dx, dy).astype(np.float32)

# Craters: radii 4-90 px, N(>r) ~ r^-2; mostly degraded (wa ~ 1). Heights in tile units.
for _ in range(900):
    r = 4 * (1 - rng.random()) ** (-1 / 2.0)
    if r > 90: continue
    wa = 1 if rng.random() > .08 else rng.random() * .4
    depth = (0.20 * (1 - wa) + 0.07 * wa) * r / N
    def crater(rho, dx, dy, depth=depth, wa=wa):
        fresh = np.where(rho < 1, -1 + rho ** 2 * 1.15, 0.15 * np.maximum(rho, 1) ** -3) * (rho < 2.4)
        old = (rho ** 2 - 1) * np.exp(-1.5 * rho ** 2) * 1.6
        return depth * (fresh * (1 - wa) + old * wa)
    stamp(rng.random() * N, rng.random() * N, r, crater)

# Clods and pebbles: radii 0.8-10 px, angular (a few half-spaces), buried 20-60 %.
for _ in range(14000):
    r = 0.8 * (1 - rng.random()) ** (-1 / 2.2)
    if r > 10: continue
    top = r / N * (0.5 + 0.5 * rng.random()); bury = 0.2 + 0.4 * rng.random()
    a = rng.random(5) * 2 * np.pi; s = 0.75 + 0.5 * rng.random(5)
    def pebble(rho, dx, dy, r=r, top=top, bury=bury, a=a, s=s):
        d = np.full(rho.shape, 0.0)
        for ai, si in zip(a, s): d = np.maximum(d, (dx * np.cos(ai) + dy * np.sin(ai)) / (r * si))
        d = np.maximum(d, rho * .85)
        body = np.sqrt(np.clip(1 - d * d, 0, 1)) * top
        return np.maximum(body - bury * top, 0) + 0.04 * top * np.exp(-((rho - 1.2) ** 2) / .2)
    stamp(rng.random() * N, rng.random() * N, r, pebble)

# Slopes (central differences, periodic) in tile units: dh/du = (h[x+1]-h[x-1]) / (2/N).
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * N / 2; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * N / 2
print('slope rms', float(np.sqrt((gx ** 2 + gy ** 2).mean())), 'max', float(np.abs(gx).max()), 'height range', float(h.min()), float(h.max()))
enc = lambda g: np.clip(np.round(128 + g / SLOPE_RANGE * 127), 0, 255).astype(np.uint8)
hb = np.clip(np.round((h - h.min()) / (h.max() - h.min()) * 255), 0, 255).astype(np.uint8)
print('height scale (tile units per 255):', float(h.max() - h.min()))
Image.fromarray(np.dstack([enc(gx), enc(gy), hb])).save('dist/assets/regolith/regolith.webp', lossless=True, method=6)
Image.fromarray(np.dstack([enc(gx), enc(gy), hb])).resize((512, 512)).save('media/realism/regolith-preview.png')
