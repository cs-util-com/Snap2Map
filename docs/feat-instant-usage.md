# Feature Specification: Instant Usage (0-1 Point Calibration)

## 1. Overview
The "Instant Usage" feature aims to provide immediate value to the user after importing a map, even before they have provided the minimum required two GPS reference points. By making sensible assumptions (perfect top down view and North is up) and only asking the user to provide a reference scale, the app can enable the measurement tool and live position tracking earlier in the workflow.

## 2. Functional Requirements

### 2.1 Zero GPS Points
*   **Measurement Tool**: Enabled if a manual `referenceDistance` (Set Scale) has been provided.
*   **Live Position**: Disabled.

### 2.2 One GPS Point
*   **Measurement Tool**: Enabled if a manual `referenceDistance` has been provided.
*   **Live Position**: **Enabled** if a manual `referenceDistance` has been provided, using a fallback calibration.
*   **Fallback Calibration (1-Point Similarity)**:
    *   **Translation**: Fixed by the single GPS reference point.
    *   **Rotation**: Assumed to be **0° (North is Up)**.
    *   **Scale**: Use `referenceDistance.metersPerPixel`.
*   **User Feedback**: Display a banner/toast: *"Using 1-point calibration (North-up). Add a second point to fix orientation and scale."*

### 2.3 Two+ GPS Points
*   **Standard Calibration**: Use the existing robust Similarity/Affine/Homography pipeline.
*   **Scale Harmonization**: If a manual `referenceDistance` is provided, it can be used to constrain the Similarity fit (Phase 2).

### 2.4 Quick Start Flow
1.  **Import Map**: User selects an image (of a map or floorplan).
2.  Ask the user to provide a reference scale, which will enable distance measurement on the image.
3.  **Initial Suggestion**: App asks: "Are you currently on this map? If so, where?".
    1.  **One-Tap Calibration**: If the user says yes, ask them to tap their current location on the photo.
    2.  **Immediate Live View**: The app immediately starts showing the live GPS position on the photo using the 1-point fallback.
    3.  **Refinement**: As the user moves, they can see if the dot follows the map. If not, they add a second point to "pin" the scale and rotation.


## 3. Technical Implementation

### 3.1 Math Layer ([src/geo/transformations.js](src/geo/transformations.js))
Implement `fitSimilarity1Point(pair, scale, rotation)` which returns a standard transform object.

```javascript
/**
 * Creates a similarity transform from a single point, scale, and rotation.
 * @param {Object} pair - { pixel: {x, y}, enu: {x, y} }
 * @param {number} scale - Meters per pixel
 * @param {number} [rotation=0] - Rotation in radians (0 = North is Up)
 */
export function fitSimilarity1Point(pair, scale, rotation = 0) {
  if (!pair || !pair.pixel || !pair.enu || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const tx = pair.enu.x - scale * (cos * pair.pixel.x - sin * pair.pixel.y);
  const ty = pair.enu.y - scale * (sin * pair.pixel.x + cos * pair.pixel.y);

  return {
    type: 'similarity',
    scale,
    rotation,
    cos,
    sin,
    translation: { x: tx, y: ty },
  };
}
```

### 3.2 Calibration Layer ([src/calibration/calibrator.js](src/calibration/calibrator.js))
Update `calibrateMap` to handle the 1-point case using a helper function.

```javascript
function calibrate1Point(enrichedPairs, origin, referenceScale, userOptions) {
  if (!referenceScale) {
    return {
      status: 'insufficient-pairs',
      message: 'A reference scale is required for 1-point calibration.',
    };
  }
  const rotation = userOptions.defaultRotation || 0;
  const model = fitSimilarity1Point(enrichedPairs[0], referenceScale, rotation);
  if (!model) {
    return {
      status: 'fit-failed',
      message: '1-point calibration failed.',
    };
  }
  return {
    status: 'ok',
    origin,
    kind: 'similarity',
    model,
    metrics: {
      rmse: 0,
      maxResidual: 0,
      inliers: enrichedPairs,
      residuals: [0],
    },
    quality: {
      rmse: 0,
      maxResidual: 0,
    },
    statusMessage: { level: 'low', message: '1-point calibration (North-up). Add a second point to fix orientation and scale.' },
    residuals: [0],
    inliers: enrichedPairs,
  };
}

export function calibrateMap(pairs, userOptions = {}) {
  // ...
  if (enrichedPairs.length === 1) {
    return calibrate1Point(enrichedPairs, origin, referenceScale, userOptions);
  }
  // ...
}
```

### 3.3 UI Layer ([src/index.js](src/index.js))
*   **Post-Import Prompt**: Immediately after map import (no scale is set yet), display a prominent "Set Scale" button.
*   **Location Prompt**: In parallel show a button *"Are you currently on this map?"*
    *   If Clicked, enter **One-Tap Calibration** mode.
*   **One-Tap Calibration UI**:
    *   When active, the next tap on the photo captures the current GPS position (waiting for accuracy if needed) and creates a single reference pair.
    *   Automatically trigger `calibrateMap()` and enable "Live" mode.
*   **Fallback Indicator**:
    *   When `state.pairs.length === 1`, show a status badge: "1-Point Calibration (North-up)".
*   **Live Button**: Enable when `state.pairs.length >= 1` AND a manual scale is set.
*   **Settings**: Add a "Default Rotation" (default: 0°).

## 4. Edge Cases & Considerations
*   **Unstable 2-Point Fit**: If two GPS points are extremely close together, the rotation becomes numerically unstable. In this case, the system should either warn the user or offer to stick to the "North-up" assumption.
*   **Missing Scale**: If the user provides 1 GPS point but hasn't set a scale yet, the "Live" mode remains disabled until the scale is defined (either because the user later decided to set the reference scale or because he decided to set a second gps reference point).

## 5. Development Progress Notes

### Phase 1: Math & Logic (Completed)
- **1-Point Similarity**: Implemented `fitSimilarity1Point` in [src/geo/transformations.js](src/geo/transformations.js). It creates a transform from a single point, a fixed scale, and an assumed 0° rotation.
- **Fixed-Scale Similarity**: Implemented `fitSimilarityFixedScale` to allow 2+ point calibration while constraining the scale to a manual reference value.
- **Calibrator Update**: Updated `calibrateMap` in [src/calibration/calibrator.js](src/calibration/calibrator.js) to support the 1-point fallback when `referenceScale` is provided.

### Phase 2: UI Integration (Completed)
- **Quick Start Prompts**: Added a dedicated prompt area in [index.html](index.html) that appears immediately after map import.
- **One-Tap Calibration**: Implemented `startOneTapMode` and `handleOneTapClick` in [src/index.js](src/index.js). This allows users to "pin" their current GPS location to a spot on the photo with a single tap.
- **Scale & Measure Modes**: Integrated the state machine from [src/scale/scale-mode.js](src/scale/scale-mode.js) to handle "Set Scale" and "Measure" interactions.
- **Persistence**: Manual scale and preferred units are now persisted in `localStorage`.

### Phase 3: Quality & Validation (Completed)
- **Unit Tests**: Added comprehensive tests for 1-point and fixed-scale transformations in [src/geo/transformations.test.js](src/geo/transformations.test.js).
- **Integration Tests**: Created [src/index.scale.test.js](src/index.scale.test.js) to verify the end-to-end "Instant Usage" flow, including prompt visibility and one-tap calibration.
- **Complexity Management**: Refactored `updateStatusText`, `recalculateCalibration`, and `setupEventHandlers` in [src/index.js](src/index.js) to keep cyclomatic complexity within limits (<= 10).
- **Coverage**: Maintained >99% statement coverage across all modified files.
- **Validation**: Verified all quality checks (`lint`, `check:dup`, `check:cycles`, `check:boundaries`) pass successfully.

### Phase 4: Expert Review & Refinement (Completed)
- **Robust One-Tap Calibration**: Improved `handleOneTapClick` to explicitly wait for a fresh GPS fix using `getCurrentPosition`, ensuring accuracy even if the background watch hasn't updated yet.
- **Intelligent Prompt Visibility**: Refactored visibility logic into `updateInstantUsagePromptsVisibility`. Prompts now stay visible until a valid 1-point or 2-point calibration is fully active (e.g., "Set Scale" stays visible if only a GPS point was added).
- **Default Rotation Setting**: Added a UI selector and persistence for "Default Rotation", allowing 1-point calibration to work for maps that are not North-up.
- **Enhanced Feedback**: Added the required instructional toast messages for 1-point calibration states to guide the user toward adding a second point.
- **Persistence**: Extended `localStorage` sync to include the new rotation setting.
