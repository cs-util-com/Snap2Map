# Snap2Map — Developer Specification (MVP)

## 0) One-line summary

**Snap2Map** lets hikers photograph a trailboard (or any map), place a few **reference pairs** between the photo and real world coordinates, and then view their **live GPS position** projected onto the photo. Works offline (photo view), with an optional **OpenStreetMap (Leaflet)** layer when online.

---

## 1) Goals & non-goals

### Goals (MVP)

* **Offline-first photo map**: Capture/import a map image and use it without connectivity.
* **Reference pairs**: Create pairs between **photo pixel** and **WGS84 (lat/lon)**.
* **Transforms**:

  * 2 pairs ⇒ **Similarity** (R, t, uniform scale)
  * 3 pairs ⇒ **Affine**
  * ≥4 pairs ⇒ **Homography**
* **Robust fit**: **RANSAC-lite + IRLS(Huber)** with **tolerant** defaults.
* **Refinement**: Optional **TPS elastic warp** with **Auto + 0–100 slider** and live preview.
* **Accuracy UI**: Residual list, heatmap, and **combined accuracy ring**.
* **Privacy**: No track history; only calibration data persists.
* **PWA**: Offline app shell; silent auto-updates.

### Non-goals (MVP)

* No cloud sync; no background GPS; no offline OSM tiles; no multi-user/real-time sharing.

---

## 2) Platforms & runtime

* **PWA (Vanilla JS, no build)**; **Tailwind via CDN**; **Leaflet** for map/UI interactions.
* **Android focus (Chrome/Edge)**; **iOS Safari & Desktop** supported with fallbacks.
* **Storage**: IndexedDB (+ optional File System Access API).
* **Updates**: Service Worker precaches shell; silent activation on next open.

---

## 3) Core user flows

### 3.1 First run

1. **Map Manager (empty state)** → short tutorial → **Import photo** (camera or gallery).
2. Import automatically launches a **guided Pair Mode** session (toasts instruct each step) so the user can capture the minimum viable set of reference pairs.
3. After ≥2 pairs, **Live** becomes available.

### 3.2 Pair Mode (add/edit) — explicit mode

* Enter via **FAB “Add pair”**, long-press on an existing marker, or automatically right after importing a map photo.
* **Top status bar** (highlighted): “Pair #n – Step 1/2” (color frame in mode). Guided mode also shows progress pills (“Photo point”, “Map point”) that swap as each step completes.
* **Bottom tabs**: **Photo** ↔ **OSM**. During guided mode the active tab auto-switches after each placement to keep the workflow hands-free.
* Flow (active slot):

  * Guided mode opens on **Photo** immediately after import and displays a toast: “Tap the first point on your photo.”
  * Once the pixel pin is dropped, the UI auto-switches to **OSM**, updates the toast (“Now tap the matching spot on the map”), and enables “Use my position” as a contextual hint.
  * Manual flow (when initiated later) still allows starting on either side.
  * After the matching map pin is placed, the pair preview appears. Guided mode automatically toggles back to the **Photo** tab, advances to the next pair, and repeats the instruction cycle until the minimum required pair count (2) is collected. After that the flow switches back to manual control while encouraging the user to add more pairs for accuracy.
* **Drag & drop** on both sides updates pair live.
* **Confirm (✓)** applies; **Cancel (←)** discards changes to the active pair only.
* Guided mode auto-confirms each pair as soon as both pins are placed, surfaces a toast summarizing the residual (“Pair saved — residual 12 m”), and exits once two pairs exist (with a prompt encouraging more for higher accuracy).
* **Outliers** shown **red**, inliers **green**; residual (m) visible in list and as label on pins.
* Edit existing pair later via long-press or from the pairs list (secondary screen).

### 3.3 Live use

* On wake: **Quick refresh** → try `getCurrentPosition` (timeout **3 s**); if none, show **last known** (≤5 min, “stale” badge). Start `watchPosition` thereafter.
* Update cadence follows device feed; UI throttles to \~**3–5 s**.
* First GPS fix recenters/zooms the photo and OSM views to the user; later updates keep the camera where the user last left it while markers/accuracy rings continue to update.
* **Accuracy ring** around user dot (see §7).

---

## 4) Image handling

* **Import**: Native file picker (`<input type="file" accept="image/*">`) lets mobile users capture a new photo or pull one from their gallery without leaving the flow.
* **Orientation**: Apply EXIF orientation, then **strip EXIF** (privacy).
* **Storage**: **Only optimized display** version, long edge ≈ **4096 px**, **WebP/AVIF** (JPEG fallback), sRGB.
* **Max per map**: 25–50 MB (config). Oversize → auto-downscale + toast.

---

## 5) Map/Viewer

* **Leaflet-first**:

  * Photo rendered as **`L.ImageOverlay`** inside a synthetic CRS (pixel coords).
  * **Markers/overlays** (anchors, heatmap, user) as Leaflet layers.
  * **Tabs** switch: **Photo overlay** ↔ **OSM standard tiles** (`tile.openstreetmap.org`, required attribution).
  * OSM just fails slowly offline; no special caching in MVP.

---

## 6) Coordinate systems & projection

* External input/output: **WGS84 (decimal degrees)** only (with optional DMS converter UI).
* Internal math: Convert WGS84 near the map area to a local **ENU tangent plane** (meters) for numerically stable fitting.
* Store both **lat/lon** and derived **ENU** snapshot (recomputed if the map origin changes).

---

## 7) Accuracy & feedback

* **Transform stages**:

  * **2 pairs** → Similarity; banner: “Accuracy low (2 points). Add more for better results.”
  * **3 pairs** → Affine; banner: “Accuracy medium (affine).”
  * **≥4 pairs** → Homography; banner: “Accuracy high (homography).”
* **Robust pipeline** (tolerant profile):

  * RANSAC-lite: **150** minimal samples, **inlier threshold 40 m**, confidence **0.98**.
  * Refit inliers with **IRLS (Huber δ=35 m, 1 iter)**.
  * **Time budget** target: **≤ 12 ms** per full refit on mid-range phone.
* **Residual UI**:

  * Pair chips list: color (green/red), **residual meters**, enable/disable, delete.
  * Pins colored (green/red). Dragging updates in real time.
* **Heatmap**: Sample grid over image; color by local projection error (based on cross-validation of pairs/TPS). Toggle in “Calibration” area.
* **Combined accuracy ring** (photo view):

  * **σ\_total = √(σ\_GPS² + σ\_Map²)** ; σ\_GPS from device accuracy; σ\_Map = local RMSE.
  * Colors: **Green ≤15 m**, **Yellow 15–30 m**, **Orange 30–60 m**, **Red >60 m**.
  * Banner prompts: **>30 m** “Add more reference points”; **>60 m** “Refine locally (TPS)”.
* **Refine (TPS)**:

  * Entry: manual button “Improve accuracy” always present; **auto-suggest** once/session if **RMSE >20 m** or **Max residual >50 m**.
  * Controls: **Auto** + **0–100 slider** (live preview).
  * Apply/Cancel; show delta RMSE before confirming.

---

## 8) GPS capture & energy

* **Reference pair (use my position)**: wait until **accuracy ≤ 8–10 m** or until **30 s timeout**; allow manual override (use best so far).
* **Live**: display current feed with accuracy ring; no enforced wait.
* **Screen-on only**: no background GPS; on wake use **Quick refresh** policy.

---

## 9) Permissions & error handling

* **On-demand prompts**; small first-time checks only when entering Live (location) or importing photo (camera/files).
* **Permanent deny**: show small help page to re-enable in browser settings.
* **GPS timeout/poor accuracy**: inline tips (clear sky view, enable Wi-Fi), still show with larger ring.
* **OSM offline**: no modal; tiles just load slowly/not at all; keep user on photo as needed.
* **Image too large**: auto-downscale + toast.
* **Storage full**: show cleanup/export suggestion.

---

## 10) Data model & persistence

### 10.1 Stores (IndexedDB, versioned schema)

* `maps` (id, name, createdAt, updatedAt, pixelSize {w,h}, photoBlobId, activeCalibrationId, stats {rmse, maxResidual}, flags)
* `pairs` (pairId, mapId, pixel {x,y}, wgs84 {lat,lon}, enu {x,y}, active\:boolean, residualMeters, isInlier\:boolean, createdAt, updatedAt)
* `calibrations` (calId, mapId, kind: 'similarity'|'affine'|'homography'|'tps', params, thresholds {ransac,irls}, quality {rmse, maxResidual}, createdAt)
* `blobs` (blobId, mime, bytes)

### 10.2 Export / import

* Single **`.mapbundle`** ZIP (via **JSZip**)

  * `meta.json` (schemaVersion, all tables)
  * `map.webp` (or jpeg/avif)
* Import merges by **mapId** (UUID); prompt on conflicts (duplicate name → append suffix).

### 10.3 File System Access API (optional)

* “Save as…” stores the `.mapbundle` or loose `map.webp` + `meta.json`.
* Re-open uses retained handles if granted.

---

## 11) Algorithms (summary & interfaces)

### 11.1 Transform estimation

* **Similarity (2 pairs)** via closed-form (Procrustes/Kabsch in 2D with uniform scale).
* **Affine (3+ pairs)** via least squares on `[x y 1]·A = [X Y]`.
* **Homography (4+ pairs)** via normalized DLT + non-linear refinement on inliers.

### 11.2 Robust fitting (RANSAC-lite → IRLS)

* Minimal sets: 2 (similarity), 3 (affine), 4 (homography).
* Score: inliers within **40 m** in ENU space.
* Keep best model; **final IRLS** on inliers with **Huber δ=35 m** (1 iteration).

### 11.3 TPS refine

* Control points = active pairs (optionally a subset near the user).
* Regularization λ from **Auto** or **0–100 slider** mapped to log-space.
* `warp(pixel)` returns corrected pixel; compose TPS after the base transform.

### 11.4 Local error estimation

* `ErrorMetrics.localRMSE(p)` samples neighborhood or uses leave-one-out on nearby pairs.

### 11.5 Numerical notes

* Normalize coordinates (mean-center & scale) before matrix solves.
* Guard against degenerate sets (near-collinear, duplicate points) → user prompt to add diverse points.

### 11.6 Module interfaces (JS, no framework)

```ts
// Type hints for clarity; implement as plain JS modules with JSDoc.

/** Maintains current transform (and TPS if active). */
export interface CalibrationModel {
  setPairs(pairs: Pair[]): void;
  setBaseKind(kind: 'similarity'|'affine'|'homography'): void;
  fitRobust(config: RobustConfig): FitResult; // runs RANSAC-lite → IRLS
  enableTPS(lambda: 'auto'|number): void;
  disableTPS(): void;
  projectLatLonToPixel(lat: number, lon: number): PointPx;
  projectPixelToLatLon(px: PointPx): {lat:number, lon:number};
  residuals(): Residual[];
  quality(): { rmse:number; maxResidual:number };
}

export interface RobustFitter {
  fitSimilarity(pairs: Pair[]): ModelSim;
  fitAffine(pairs: Pair[]): ModelAff;
  fitHomography(pairs: Pair[]): ModelH;
  ransac(kind, pairs, cfg): {model, inliers:Set, rmse, maxResidual};
  irls(kind, pairsInliers, cfg): {model, rmse, maxResidual};
}

export interface RefinerTPS {
  fit(pairs: Pair[], lambda: 'auto'|number): TPSModel;
  warp(px: PointPx): PointPx; // composition on top of base transform
}

export interface ErrorMetrics {
  localRMSE(px: PointPx): number;
  heatmap(samples: PointPx[]): Float32Array; // meters per sample
}

export interface PositionProjector {
  setCalibration(model: CalibrationModel): void;
  toPixel(pos: {lat,lon,accuracy}): {px:PointPx, sigmaMap:number, sigmaTotal:number};
}
```

---

## 12) UI & components

* **Screens**

  * **Map Manager** (list of saved maps; card shows name, thumbnail, last RMSE).
  * **Map Detail** with bottom tabs:

    * **Photo** (ImageOverlay, anchor pins, heatmap toggle, accuracy ring)
    * **OSM** (standard tiles, user dot, can place map pins)
  * **Pair Mode** (status bar + amber frame; ✓ Confirm / ← Cancel; guided variant adds instruction toasts and auto-tab switching)
  * **Settings/Info** (language: English; tile URL override; export/import; reset)
* **Anchors**

  * Pins draggable on both tabs; snap UI loupe on photo for pixel precision.
  * Pair chips: ID/Color, residual m, toggle active, delete.
* **Refine (TPS) drawer**

  * Auto + **0–100** slider; live before/after; **Apply/Cancel**; show RMSE change.
* **Accuracy**

  * Combined ring (photo); device’s native on OSM view (Leaflet defaults).
* **Toasts/banners**

  * Version update ready (auto on next open).
  * Guided pairing script: “Tap the first point on your photo”, “Now tap the matching spot on the map”, “Pair saved — residual ··m. Add another for better accuracy.”
  * Prompts: add more points / refine when thresholds exceeded.
  * Errors: storage full, file too big, permissions denied.

---

## 13) Performance budgets

* **Refit (RANSAC→IRLS)**: target **≤12 ms** typical; worst-case ≤30 ms.
* **Drag FPS**: ≥ **50 FPS** median during marker drag (throttle re-fit to animation frames).
* **Heatmap**: sampling grid adaptively thinned on low-end devices.

---

## 14) Security & privacy

* **No position history** persisted.
* Only calibration pairs and image stored locally (IndexedDB/files).
* **Export** never includes live positions.
* **EXIF stripped**; sRGB normalized.
* **Disclaimer** (About screen): “Not for precise navigation. GPS and map alignment may be inaccurate.”

---

## 15) Attribution & licensing (runtime)

* Show **OpenStreetMap** attribution in OSM tab (Leaflet control).
* Show **Leaflet** attribution per license in About.

---

## 16) Testing plan (Balanced)

### 16.1 Unit & property tests (math)

* Similarity/affine/homography: golden cases + noise injection (3–5 m).
* Property: invariance under translation/rotation/scaling; numerical stability with normalization.
* TPS: sanity under λ extremes; monotonic RMSE vs. λ on controlled distortions.

### 16.2 E2E (Playwright or WebTestRunner-style with mocks)

* Photo import (camera & gallery), pair mode flow, drag adjustments.
* Live quick refresh (getCurrentPosition timeout path).
* Service Worker offline start; OSM tab online/offline.
* Cross-browser smoke: **Android Chrome**, **iOS Safari**, **Desktop Chrome**.

### 16.3 Acceptance criteria

* With 2 pairs (similarity): accuracy labeled “low”; no hard numeric target.
* With 3 pairs (affine) and 3–5 m input noise: **RMSE ≤ 20 m** local.
* With 4+ pairs (homography): **RMSE ≤ 12 m** local.
* Refit time meets budget; drag interaction smooth.

---

## 17) Repo layout (suggested; no build step)

```
/public
  index.html
  /icons   (PWA icons, maskable)
/src
  /ui      (dom components, mode bars, toasts)
  /leaflet (map init, layers, image overlay, markers)
  /calib   (transform, ransac, irls, tps, error-metrics, projector)
  /data    (indexeddb schema, file system access, export/import zip)
  /gps     (position providers, quick refresh policy)
  /pwa     (sw.js, manifest.json, update logic)
  /util    (math helpers, enu projection, exif/orientation, image resize)
/styles    (tailwind setup via CDN in index.html; minimal custom css)
/tests
  unit/    (math & utils)
  e2e/     (flows with mocks)
manifest.json
sw.js
```

---

## 18) Key configuration (defaults)

* RANSAC: threshold **40 m**, samples **150**, conf **0.98**.
* IRLS Huber δ **35 m**, iters **1**.
* TPS slider 0–100 → λ in log-space (e.g., 1e-6 … 1e+2).
* Auto-refine suggestion: **RMSE > 20 m** or **Max residual > 50 m** (once per session).
* Live accuracy ring thresholds: **15/30/60 m**.
* Photo max dimension: **4096 px** long edge.

