# Initial idea for new feature of Snap2Map

## 1. Core Functional Requirements

* **Manual Reference Distance:** Users can draw a line between two points on the photo/map and assign an explicit metric value (e.g., "This wall is 5 meters").
* **Derived Measurements:** Once this reference is set, users can measure arbitrary objects in the image (e.g., width of a door), even if those objects had no dimensions in the original plan.
* **GPS Independence:** This feature must work **autonomously**. The user must be able to measure distances immediately after importing an image, *before* setting a single GPS reference pair.
* *Flow:* Start App → Import Map → Define Reference Distance → Measure immediately.

## 2. Data Prioritization & "Ground Truth"

* **Reference as "Ground Truth":** The manually entered distance is interpreted as the most reliable truth (weighted higher than GPS data).
* *Rationale:* Users often transcribe precise measurements from architectural plans or blueprints.


* **Accuracy Assumption:** The manual input is assumed to be more precise than GPS position data (which inherently fluctuates), despite potential minor clicking errors.
* **Conflict Resolution (Harmonization):**
* The system must harmonize the manual scale (pixels per meter) with the GPS-derived scale.
* In case of divergence between GPS calculations and the manual reference, the manual reference serves to **validate** or constrain the GPS solution (the manual scale takes precedence for local measurements).

## 3. User Story

* **Scenario:** A user imports a floor plan or house blueprint.
* **Step 1:** They identify a known dimension on a long wall (e.g., 10m) and mark this as the **Reference Distance**.
* **Step 2:** They want to know the width of the front door (which has no label on the PDF).
* **Step 3:** They measure the door on the image, and the app calculates the width based on the wall's reference scale.

## 4. Technical Implications

* **Hybrid State:** The system requires a flexible scaling state. The map scale (meters/pixel) can be defined by:
1. Purely manual reference distance.
2. Purely GPS reference pairs.
3. A combination (where the manual reference acts as an anchor/validator for the GPS fit).

# Refined implementation plan based on the initial idea and current code base

## 1. Data Model & State Management

We need to extend the application state to store the manual reference.

*   **New State Property**: `referenceDistance`
    ```javascript
    {
      p1: { x: number, y: number }, // Pixel coordinates
      p2: { x: number, y: number }, // Pixel coordinates
      meters: number,               // User-defined distance
      metersPerPixel: number        // Derived scale: meters / distance(p1, p2)
    }
    ```
    *   **Note**: `metersPerPixel` aligns with the backend's `referenceScale` parameter (meters/pixel), which can be passed directly to `calibrateMap()`.
*   **Persistence**: This should be added to the `maps` store in `IndexedDB` (or the runtime `state` object in `src/index.js` for the MVP) to persist across sessions.

## 2. UI/UX Implementation

### 2.1 Reference Mode ("Set Scale")
*   **Entry Point**: A new "Set Scale" button in the map toolbar (icon: ruler).
*   **Interaction Flow**:
    1.  User taps "Set Scale".
    2.  Toast: "Tap start point of known distance".
    3.  User taps point A on the photo.
        * The user should be able to zoom in on the image while doing these taps, to place the points as accurate as possible. 
        * So zooming in general via pinch gestures (or mouse wheel on desktop) in the image would be an important UX to have in general in the app (in case it does not exist yet)
    4.  Toast: "Tap end point".
    5.  User taps point B on the photo.
    6.  **Input Dialog**: A prompt appears asking "Enter distance in meters".
    7.  **Visual Feedback**: A distinct line (e.g., blue dashed) is drawn between A and B with the label "X m".
*   **Edit/Delete**: Tapping the reference line allows editing the value or deleting it.

### 2.2 Measurement Mode
*   **Entry Point**: "Measure" button (icon: tape measure), enabled if a **scale can be determined** from either:
    1.  A manual `referenceDistance` (user-defined reference line with known meters).
    2.  A successful GPS-based calibration (scale derived from the calibration transform).
*   **Scale Source Priority**: When both sources exist, `referenceDistance.metersPerPixel` takes precedence (manual measurement is considered more precise than GPS-derived scale).
*   **Interaction Flow**:
    1.  User taps "Measure".
    2.  User taps to set a start point of the temporary measure line. (The user can still zoom and move around on the image while doing so)
    3. User taps to set the end point of the temporary measure line. (The user can still zoom and move around on the image while doing so)
    4.  **Real-time Feedback**: A label on the line shows the distance in meters, calculated as `pixelDistance * activeMetersPerPixel` (where `activeMetersPerPixel` is sourced from `referenceDistance` if set, otherwise from the GPS calibration).
    5. Afterwards the user can still long press and drag the start and end points of the measure line around on the image to refine their initial placement of these 2 points

## 3. Logic & Calibration Integration

### 3.1 GPS Independence (Phase 1)
*   The `referenceDistance` allows immediate measurement without any GPS pairs.
*   The map remains in "Image Space" (pixels) but with a known scalar for distance.
*   This fulfills the requirement: *Start App → Import Map → Define Reference Distance → Measure immediately.*

### 3.2 Hybrid Calibration (Phase 2)
*   **Conflict Resolution Strategy**: "Constrained Similarity".
*   **Algorithm**:
    1.  **Standard Fit**: Run the existing RANSAC/IRLS to get a candidate model (Similarity/Affine).
    2.  **Scale Check**: Calculate the scale of the candidate model ($S_{gps}$).
    3.  **Comparison**: Compare $S_{gps}$ with $S_{manual}$ (from reference distance).
    4.  **Harmonization**:
        *   **Similarity (2 pairs)**: If a manual reference exists, we can optionally **force** the scale to $S_{manual}$. This reduces the Similarity transform to finding only Rotation ($R$) and Translation ($t$).
            *   **Benefit for GPS Visualization**: This significantly stabilizes the user's position on the map. With only 2 GPS points, the scale is extremely sensitive to GPS noise (e.g., a 5m error can drastically zoom the map in/out). Fixing the scale locks the "zoom level" to the trusted manual measurement, leaving GPS to only solve for position and orientation. This prevents the map from "breathing" or jumping in size as the user moves.
        *   **Affine/Homography (3+ pairs)**: Use $S_{manual}$ as a **validator**. If the local scale of the GPS-derived transform differs significantly (e.g., > 10%) from $S_{manual}$, show a warning: "GPS scale disagrees with manual reference."

## 4. Code Structure Changes

### `src/index.js`
*   Add `referenceDistance` to `state`.
*   Implement `startReferenceMode()` and `startMeasureMode()`.
*   **Interaction Handling**:
    *   Use `L.Marker` with `draggable: true` for the start and end points of the reference/measurement lines. This allows the user to refine the position after the initial tap (as requested in the UX spec).
    *   Ensure `L.Polyline` connects these markers and updates in real-time during drag events.
*   Handle canvas/overlay drawing for the reference line and active measurement line.

### `src/geo/transformations.js`
*   Implement `fitSimilarityFixedScale(pairs, fixedScale)`:
    *   Standard Procrustes analysis but with $s$ fixed to `fixedScale`.
    *   Solves for rotation $\theta$ and translation $t_x, t_y$ minimizing the error.
    *   *Implementation Note*: Reuse the centroid and rotation calculation from `fitSimilarity`. Instead of computing `scale = numerator / denom`, use `scale = fixedScale` and compute translation based on this fixed scale.

### `src/calibration/calibrator.js`
*   Update `calibrateMap` to accept an optional `referenceScale`.
*   If `referenceScale` is provided and the model is 'similarity', use `fitSimilarityFixedScale`.

## 5. Testing Plan

*   **Unit Tests (`src/geo/transformations.test.js`)**:
    *   Test `fitSimilarityFixedScale` with synthetic data.
    *   Verify that the resulting transform preserves the input scale exactly.
*   **Integration Tests**:
    *   Verify that setting a reference distance enables the measure tool.
    *   Verify that measurements are accurate based on the reference.

---

## 6. Implementation Progress

### ✅ Phase 1: Backend Math Layer (Completed)

**Date:** 2025-12-21

This phase implements the core math needed to support a fixed reference scale in the calibration pipeline.

#### `src/geo/transformations.js`
- [x] Implemented `fitSimilarityFixedScale(pairs, fixedScale, weights)` function
  - Procrustes analysis with fixed scale parameter
  - Solves only for rotation (θ) and translation (tx, ty)
  - Supports weighted pairs for IRLS integration
- [x] Exported via module API

#### `src/geo/transformations.test.js`
- [x] Added 13 comprehensive unit tests:
  - Preserves exact fixed scale with known transform
  - Uses fixed scale even when data suggests different scale
  - Correctly finds rotation when scale is fixed
  - Computes correct translation with fixed scale
  - Returns null for insufficient pairs
  - Returns null for invalid fixed scale (0, NaN, Infinity)
  - Returns null for zero total weight
  - Respects weights in rotation computation (using 3 pairs)
  - 2 pairs produce same rotation regardless of weights (geometric symmetry)
  - 3 pairs with one zero weight behaves like 2 pairs
  - Handles negative rotation correctly
  - Returns null for degenerate coincident pixel points
  - Handles 180 degree rotation

#### `src/calibration/calibrator.js`
- [x] Updated `calibrateMap` to accept optional `userOptions.referenceScale`
- [x] Updated `fitModel` to use `fitSimilarityFixedScale` when `referenceScale` is provided and model is 'similarity'
- [x] Updated `runReweightedFit` to pass `referenceScale` through IRLS pipeline
- [x] Updated `runRansacForKind` to pass `referenceScale` through RANSAC pipeline

#### `src/calibration/calibrator.test.js`
- [x] Added 3 integration tests:
  - `calibrateMap` uses fixed scale when `referenceScale` is provided
  - Fixed scale overrides natural GPS-derived scale
  - `referenceScale` only affects similarity model, not affine/homography

**Test Results:** 46 tests pass, 98.37% code coverage

#### Key Learnings

**2-Pair Geometric Symmetry Property:**
During test development, we discovered an important mathematical property of `fitSimilarityFixedScale`:

> With exactly 2 pairs, weights cannot influence the computed rotation angle.

This occurs because the weighted Procrustes rotation formula uses:
$$\theta = \arctan2\left(\sum w_i(e_y p_x - e_x p_y), \sum w_i(e_x p_x + e_y p_y)\right)$$

With only 2 pairs positioned symmetrically around the weighted centroid, the cross and dot contributions maintain equal ratios regardless of weight distribution. This means:
- **2 GPS pairs + fixed scale**: Rotation is fully determined by geometry, weights only affect translation
- **3+ GPS pairs + fixed scale**: Weights properly influence rotation computation

This property is now documented in the test suite to prevent future confusion.

---

### 🔲 Phase 2: UI Layer (Not Started)

This phase implements the user-facing features: setting a reference distance and measuring arbitrary distances.

#### `src/index.js`
- [ ] Add `referenceDistance` to application state
- [ ] Implement "Set Scale" mode (`startReferenceMode()`)
  - Two-tap workflow to define reference line
  - Input dialog for distance in meters
  - Visual feedback with dashed line and label
- [ ] Implement "Measure" mode (`startMeasureMode()`)
  - Two-tap workflow to draw measurement line
  - Real-time distance calculation using `metersPerPixel`
  - Draggable endpoints for refinement
- [ ] Add UI buttons to toolbar
- [ ] Persistence of `referenceDistance` to IndexedDB



