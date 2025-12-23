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
2.  Ask the user to provide a reference scale so that once he did provide that reference scale he can measure any distances on the image
3.  **Initial Suggestion**: App asks: "Are you on currently on this map? If yes where".
    1.  **One-Tap Calibration**: If user says yes ask him to tap their current location on the photo.
    2.  **Immediate Live View**: The app immediately starts showing the live GPS position on the photo using the 1-point fallback.
    3.  **Refinement**: As the user moves, they can see if the dot follows the map. If not, they add a second point to "pin" the scale and rotation.


## 3. Technical Implementation

### 3.1 Math Layer (`src/geo/transformations.js`)
Implement `fitSimilarity1Point(pair, scale, rotation)` which returns a standard transform object.

```javascript
/**
 * Creates a similarity transform from a single point, scale, and rotation.
 * @param {Object} pair - { pixel: {x, y}, enu: {x, y} }
 * @param {number} scale - Meters per pixel
 * @param {number} [rotation=0] - Rotation in radians (0 = North is Up)
 */
export function fitSimilarity1Point(pair, scale, rotation = 0) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Matrix: [m00, m01, m10, m11, tx, ty]
  // enu.x = m00 * px + m10 * py + tx
  // enu.y = m01 * px + m11 * py + ty
  const m00 = scale * cos;
  const m01 = scale * sin;
  const m10 = -scale * sin;
  const m11 = scale * cos;

  const tx = pair.enu.x - (m00 * pair.pixel.x + m10 * pair.pixel.y);
  const ty = pair.enu.y - (m01 * pair.pixel.x + m11 * pair.pixel.y);

  return {
    matrix: [m00, m01, m10, m11, tx, ty],
    kind: 'similarity',
    rmse: 0,
    maxResidual: 0,
    inliers: [pair],
  };
}
```

### 3.2 Calibration Layer (`src/calibration/calibrator.js`)
Update `calibrateMap` to handle the 1-point case.

```javascript
function calibrateMap(pairs, userOptions = {}) {
  // ...
  if (pairs.length === 1) {
    const scale = userOptions.referenceScale;
    if (!scale) return null; // Cannot calibrate 1-point without scale
    const rotation = userOptions.defaultRotation || 0;
    const model = fitSimilarity1Point(enrichedPairs[0], scale, rotation);
    return { ...model, origin, pairs: enrichedPairs };
  }
  // ...
}
```

### 3.3 UI Layer (`src/index.js`)
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
