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
      pixelsPerMeter: number        // Derived scale: distance(p1, p2) / meters
    }
    ```
*   **Persistence**: This should be added to the `maps` store in `IndexedDB` (or the runtime `state` object in `src/index.js` for the MVP) to persist across sessions.

## 2. UI/UX Implementation

### 2.1 Reference Mode ("Set Scale")
*   **Entry Point**: A new "Set Scale" button in the map toolbar (icon: ruler).
*   **Interaction Flow**:
    1.  User taps "Set Scale".
    2.  Toast: "Tap start point of known distance".
    3.  User taps point A on the photo.
    4.  Toast: "Tap end point".
    5.  User taps point B on the photo.
    6.  **Input Dialog**: A prompt appears asking "Enter distance in meters".
    7.  **Visual Feedback**: A distinct line (e.g., blue dashed) is drawn between A and B with the label "X m".
*   **Edit/Delete**: Tapping the reference line allows editing the value or deleting it.

### 2.2 Measurement Mode
*   **Entry Point**: "Measure" button (icon: tape measure), enabled **only** if `referenceDistance` is set.
*   **Interaction Flow**:
    1.  User taps "Measure".
    2.  User taps/drags to draw a temporary line.
    3.  **Real-time Feedback**: A label on the line shows the distance in meters, calculated as `pixelDistance / state.referenceDistance.pixelsPerMeter`.

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
        *   **Similarity (2 pairs)**: If a manual reference exists, we can optionally **force** the scale to $S_{manual}$. This reduces the Similarity transform to finding only Rotation ($R$) and Translation ($t$). This is mathematically more robust when GPS accuracy is low but the manual measurement is trusted.
        *   **Affine/Homography (3+ pairs)**: Use $S_{manual}$ as a **validator**. If the local scale of the GPS-derived transform differs significantly (e.g., > 10%) from $S_{manual}$, show a warning: "GPS scale disagrees with manual reference."

## 4. Code Structure Changes

### `src/index.js`
*   Add `referenceDistance` to `state`.
*   Implement `startReferenceMode()` and `startMeasureMode()`.
*   Handle canvas/overlay drawing for the reference line and active measurement line.

### `src/geo/transformations.js`
*   Implement `fitSimilarityFixedScale(pairs, fixedScale)`:
    *   Standard Procrustes analysis but with $s$ fixed to `fixedScale`.
    *   Solves for rotation $\theta$ and translation $t_x, t_y$ minimizing the error.

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


