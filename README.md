# Horisite · Lunar Landing Site Navigator

![Horisite logo](brand/horisite-logo-black.png)

**Land where the light lasts.** Explore the Moon's south pole to compare sunlight and Earth visibility over real terrain, by site and date.

A NASA Space Apps Challenge 2026 project for **Lunar Landing Site Navigator**, by **Team Counter Force**, Ribeirão Preto, Brazil.

## Live links and presentation

| Resource | Link |
| --- | --- |
| Website | [Open Horisite](https://187.77.229.205) |
| Explorer | [Compare sites and dates](https://187.77.229.205/app/) |
| Illustrated tutorial | [Follow the examples](https://187.77.229.205/tutorial.html) |
| 30-second demo video | [Watch online](https://187.77.229.205/media/horisite-demo-30s.mp4) · [Repository copy](project-reports/horisite-demo-30s.mp4) · [Captions (SRT)](project-reports/horisite-demo-30s.srt) |
| Seven-slide presentation | [View online](https://187.77.229.205/slides/) · [PDF online](https://187.77.229.205/slides/horisite-space-apps-2026.pdf) · [Repository copy](project-reports/) |

The presentation and the video are published with the site (`dist/slides/`, `dist/media/`); the originals live in [project-reports/](project-reports/).

## The challenge and the problem

The challenge asks for an intuitive way to compare lunar landing sites and dates through the positions of the Sun and Earth on the horizon. At the south pole, terrain can change both the available sunlight and the line of sight to Earth.

- **Power:** the Sun skims the horizon; a distant ridge can block light reaching a solar panel.
- **Contact:** Earth sits low in the sky, where relief can hide it.
- **No quick answer:** ephemerides, terrain maps and time windows are spread across separate, complex tools.

Slide 2 of the [presentation](project-reports/index.html) uses the **IM-2 Athena lander in March 2025** as an example: approximately **250 m off target**, inside a cold, shadowed crater, with solar panels unable to recharge its batteries. It reports a planned **10-day** surface mission that lasted **under 13 hours**. The slide's source line is **“Astronomy magazine; Intuitive Machines.”**

## What Horisite does

| Feature | What to look for |
| --- | --- |
| A verdict for each body | Sun and Earth visibility, explained as **in the sky − relief = margin** in degrees. |
| **Light on a panel** | Incident sunlight in W/m², with **Tracks the Sun** and **Horizontal** panel orientations. |
| **What the relief hides** | A 360° horizon chart with the Sun, Earth and their paths over the next 24 hours. |
| Sun+Earth bars per site | Hourly visibility over 24 hours: Sun on top, Earth below, with hatching when hidden behind relief. |
| **Best window** | The longest common interval with Sun and Earth in view across the compared sites, searched over the next 30 days. |
| Site comparison | Compare up to **3 of 5** regions: Shackleton rim, Malapert massif, de Gerlache region, Nobile rim and Haworth region. |
| **3D relief** | LOLA terrain at true vertical scale, Sun shadows, and rays showing where relief blocks the Sun or Earth. |
| **Surface** | Walk and jump with lunar gravity beside the NASA lunar module model; use keyboard or on-screen controls. |
| **Globe** | View the whole Moon and its illumination. |
| Permanent shadow | Toggle the PGDA map of permanently shadowed regions. |
| Solar eclipses by Earth | Partial and total occultation of the Sun, with the resulting reduction in direct sunlight. |
| **Simulate mission** | An Earth–Moon–Earth mission using an Apollo 11 profile and a landing inside the selected visibility window. |
| Language and devices | English and Portuguese, responsive layouts and touch controls for phones. |

The explorer also provides observer-height controls, a telephoto view of Earth and a first-visit guide. Where the browser supports WebMCP, it registers `configure_lunar_comparison` and `read_lunar_visibility` for configuring comparisons and reading model results.

## How to use it

The six steps from the presentation:

1. **Pick your sites.** Select a name to explore a region; use **+** to compare up to three sites.
2. **Set the moment.** Choose a date and UTC time. Jump a day or a week to test a delay.
3. **Read the answer.** Check each body's verdict, the sky − relief = margin calculation, and the light in W/m².
4. **Check what blocks them.** Follow the rays over the terrain and inspect the horizon profile.
5. **Play the day.** Read the Sun+Earth bars to see, hour by hour, when each site sees both.
6. **Find the window, then fly it.** Use **Best window** for its duration and dates, then **Simulate mission** to visit it.

## Data and methods

### Terrain and permanent shadow

[NASA GSFC PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) supplies the LRO/LOLA south-pole DEMs and permanent-shadow map. [prepare-terrain.mjs](scripts/prepare-terrain.mjs) reads site windows from Cloud-Optimized GeoTIFFs using HTTP Range requests, rather than downloading the complete DEMs.

Each site has four layers in [dist/data/](dist/data/):

| File pattern | Extent | Grid and output spacing | Source |
| --- | --- | --- | --- |
| `<site>.bin` | 100 × 100 km | 769 × 769 points, approximately 130 m | 80 m overview of `LDEM_80S_20MPP_ADJ` (20 m native DEM). |
| `<site>-inner.bin` | 20 × 20 km, centred on the site | 513 × 513 points, approximately 39 m | 40 m overview of `LDEM_80S_20MPP_ADJ`. |
| `<site>-wide.bin` | 400 × 400 km | 257 × 257 points, approximately 1.56 km | `LDEM_60S_240MPP_ADJ`, read at its 480 m overview, for the distant horizon. |
| `<site>-psr.bin` | 100 × 100 km | 769 × 769 points, approximately 130 m | `LPSR_80S_20MPP_ADJ`; permanent-shadow fraction encoded as 0–255, with 255 representing permanent shadow. |

When legacy SVS terrain tiles are available, the preparation script compares the new crop with them; otherwise, it retains the recorded validation. It stops before writing if the validation indicates a projection or orientation mismatch. The recorded comparison with the earlier **474 m SVS DEM** gave **7.6–8.6 m mean absolute differences** across the five sites and correlations of **approximately 0.99994 or higher**. The minimum stored correlation is `0.999939609066943`; the full results are in [metadata.json](dist/data/metadata.json).

The geometry includes lunar curvature. The horizon is sampled every **0.5°** of azimuth, using detailed terrain out to **50 km** and wider context out to approximately **195 km**. The Moon has no atmosphere, so the lunar horizon calculation applies no atmospheric refraction.

### Sky, light and rendering

- **Ephemerides:** Astronomy Engine **2.1.19** calculates positions locally, without runtime ephemeris API requests, using geometric J2000 vectors, approximate IAU lunar orientation and observer parallax. Sun and Earth positions are checked against a JPL Horizons reference case.
- **Panel light:** incident irradiance starts at **1361 W/m² at 1 AU**, scales with Sun distance, and accounts for the visible solar-disc fraction, eclipses and panel orientation. This is incident light, before electrical efficiency, losses, temperature or battery storage.
- **Stars:** HYG **v4.1**, down to visual magnitude **6**, at J2000 positions without proper motion.
- **Rendering:** Three.js **0.186.1**, lunar-Lambert regolith shading and Sun shadows. Earth is oriented by sidereal time, with its phase, clouds and night lights. NASA SVS supplies lunar imagery and the Milky Way background.
- **Spacecraft:** official NASA 3D Resources **Apollo Lunar Module** and **Apollo Soyuz** assets; only the Apollo spacecraft from the latter is used. The Surface view adapts the lunar module's markings to NASA Space Apps Challenge branding.
- **Mission imagery:** NASA SVS/LROC lunar colour maps and LOLA-derived normals; NASA Blue Marble, Black Marble and MODIS imagery for Earth, alongside the Three.js Earth textures.

### Interpretation and limits

Earth visibility is a line of sight to its centre, not a validated communication link. Site coordinates are regional reference points, not certified landing ellipses. The best-window search samples hourly; events between samples are not resolved.

Surface micro-relief, small craters, rocks and ground-brightness variations below the terrain mesh are synthetic visual details. The optional reading light is not physical. While walking, visibility is also evaluated from the current position; the answer panel retains the reference site's numbers.

The mission uses circular parking orbits with JPL DE440 gravitational parameters. Transfers, burns, ascent, descent and re-entry are illustrative, without a Lambert solution, three-body integration, fuel or delta-v modelling. A sunlight-and-visibility window is not an orbital launch window. Horisite is for exploration and education.

## Accuracy and verification

With the project dependencies installed, run:

```sh
npm run check
```

This runs [check-model.mjs](scripts/check-model.mjs) and [check-mission.mjs](scripts/check-mission.mjs) locally, without network requests:

- Lunar-frame geometry and libration, terrain curvature, observer height, irradiance, visibility, eclipses and continuous-interval selection.
- Sun and Earth azimuth/elevation against a stored JPL Horizons case at Shackleton on **2026-10-02 at 12:00 UTC**, with a **0.01°** tolerance.
- Mission dates and window constraints, position and attitude continuity, Kepler orbit periods and speeds, transfer clearance across the five sites, and camera transitions.

For a fresh external ephemeris comparison:

```sh
node scripts/validate-horizons.mjs
```

This requires network access and installed dependencies. It queries JPL Horizons sequentially for the Sun and Earth at the reference date and prints the JPL and local values for comparison; it does not enforce a numerical tolerance. [tutorial-examples.mjs](scripts/tutorial-examples.mjs) recalculates the illustrated tutorial's examples.

## Repository map

| Location | Contents |
| --- | --- |
| [dist/](dist/) | The complete static site, served as-is. **No build step.** |
| [dist/index.html](dist/index.html), `landing.css`, `landing.js`, `landing-site.js` | Landing page and its illuminated Moon. |
| [dist/app/](dist/app/), [app.js](dist/app.js) | Explorer page, styles and application controls. |
| [dist/model.js](dist/model.js), [sites.js](dist/sites.js), [i18n.js](dist/i18n.js) | Geometry, visibility and irradiance calculations; regional reference sites; English/Portuguese interface text. |
| [dist/scene.js](dist/scene.js), [lunar-surface.js](dist/lunar-surface.js), [mission-model.js](dist/mission-model.js), [mission-scene.js](dist/mission-scene.js) | Terrain and Surface rendering, mission model and mission rendering. |
| [dist/tutorial.html](dist/tutorial.html), [dist/tutorial/](dist/tutorial/) | Illustrated guide and English/Portuguese screenshots. |
| [dist/data/](dist/data/) | Terrain and permanent-shadow binaries, `metadata.json`, and `stars.json`. |
| [dist/assets/](dist/assets/), [dist/brand/](dist/brand/), [dist/vendor/](dist/vendor/) | Textures, spacecraft models, site branding and vendored libraries/add-ons. |
| [scripts/](scripts/) | Local server and launcher, data preparation, model/mission checks, Horizons comparison and tutorial examples. |
| [project-reports/](project-reports/) | Hackathon presentation (`index.html`, `img/`, PDF) and the 30-second demo video with its captions. Published copies: `dist/slides/` and `dist/media/`. |
| [docs/](docs/) | Internal **Portuguese** notes, retained in their original language: [product](docs/PRODUCT.md), [design](docs/DESIGN.md) and [evaluation](docs/EVALUATION.md). |
| [brand/](brand/) | Original black and white Horisite logo PNGs. |
| Root files | [README.md](README.md), [package.json](package.json), [pnpm-lock.yaml](pnpm-lock.yaml), [start-horisite.cmd](start-horisite.cmd) and [.gitignore](.gitignore). |
| `.openai/` | Original author's hosting configuration. |

## Run locally

Everything needed to serve the site is already in `dist/`. **No dependency installation or build is required to run it.** Use Node.js:

```sh
npm start
```

Open [http://localhost:4173](http://localhost:4173) for the landing page or [http://localhost:4173/app/](http://localhost:4173/app/) for the explorer. Keep the terminal open when using `npm start`.

On Windows, double-click [start-horisite.cmd](start-horisite.cmd), or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

The Windows launcher leaves the local server running after the command closes. The Node server listens only on `127.0.0.1` and `::1`, writes logs to `artifacts/localhost-server.log`, and does not create a service or scheduled task.

Alternatively, with Python:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

### Regenerate data and assets

For development and regeneration, install the pinned dependencies:

```sh
pnpm install
```

These commands regenerate files under `dist/`; downloads require network access.

| Command | Result |
| --- | --- |
| `node scripts/prepare-data.mjs` | Copies the vendored libraries and Three.js add-ons, downloads base textures, then calls terrain preparation. |
| `node scripts/prepare-terrain.mjs` | Regenerates the four PGDA terrain/permanent-shadow layers per site and metadata. |
| `node scripts/prepare-stars.mjs` | Regenerates `stars.json` from HYG v4.1. |
| `node scripts/prepare-mission-assets.mjs` | Downloads and prepares the mission texture sets, including 4096 px and 8192 px assets. Requires `ffmpeg` and `ffprobe`. |
| `node scripts/tutorial-examples.mjs` | Recalculates tutorial examples. |

The NASA spacecraft GLBs are included in [dist/assets/mission/models/](dist/assets/mission/models/). The preparation scripts copy Three.js loaders and post-processing code to `dist/vendor/addons/`.

## Credits and data sources

| Source | Use and credit |
| --- | --- |
| [NASA GSFC PGDA / LRO LOLA](https://pgda.gsfc.nasa.gov/products/90) | South-pole terrain and permanent shadow; Barker et al. (2023), *The Planetary Science Journal*, **4:183** ([paper](https://doi.org/10.3847/PSJ/acf3e1)). |
| [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) | LROC lunar colour imagery and LOLA elevation data; NASA/GSFC/Arizona State University. |
| [NASA SVS Deep Star Maps](https://svs.gsfc.nasa.gov/4851/) | Milky Way background. |
| [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | Apollo Lunar Module and Apollo Soyuz models. |
| [NASA Blue Marble](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/september/world.200409.3x21600x10800.jpg), [Black Marble](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg), [Blue Marble clouds](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif), [NASA GIBS](https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi) | Mission Earth day, night-light, cloud and MODIS water-mask imagery; source URLs and processing are recorded in [prepare-mission-assets.mjs](scripts/prepare-mission-assets.mjs). |
| [Astronomy Engine](https://github.com/cosinekitty/astronomy) | Ephemerides; MIT license included in the [vendored bundle header](dist/vendor/astronomy.browser.min.js). |
| [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), [JPL DE440 parameters](https://ssd.jpl.nasa.gov/astro_par.html) | Ephemeris reference and orbital gravitational parameters. |
| [HYG Database](https://github.com/astronexus/HYG-Database) | v4.1 star catalogue, CC BY-SA 4.0. |
| [Three.js](https://threejs.org/) | Rendering, add-ons and example Earth textures; [MIT license](dist/vendor/THREE-LICENSE.txt). |

## Team

**Counter Force — Ribeirão Preto, Brazil**

- Marcus Fabio Galvão Facine
- Victor Arantes Lino
- Ricardo Coradini de Marco Moretti
- Haroldo Curti e Silva
- Ariane Praxedes Silva
- Carla Giovana Lopez Tarqui

## Use of AI

Development was assisted by AI coding tools: Claude Code by Anthropic and Codex by OpenAI. The demo video's narration uses a synthetic neural voice.
