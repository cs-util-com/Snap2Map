# Feature Specification: Instant Usage (0-1 Point Calibration)

## 1. Overview
The "Instant Usage" feature aims to provide immediate value to the user after importing a map, even before they have provided the minimum required two GPS reference points. By making sensible assumptions (e.g., North is up, standard floorplan scale), the app can enable the measurement tool and live position tracking earlier in the workflow.

## 2. Functional Requirements

### 2.1 Zero GPS Points
*   **Measurement Tool**: Enabled if a manual `referenceDistance` (Set Scale) has been provided.
*   **Live Position**: Disabled.
*   **Assumptions**: None.

### 2.2 One GPS Point
*   **Measurement Tool**: Enabled if a manual `referenceDistance` has been provided.
*   **Live Position**: **Enabled** using a fallback calibration.
*   **Fallback Calibration (1-Point Similarity)**:
    *   **Translation**: Fixed by the single GPS reference point.
    *   **Rotation**: Assumed to be **0° (North is Up)**.
    *   **Scale**:
        1.  Use `referenceDistance.metersPerPixel` if available.
        2.  Otherwise, use a **Default Scale** (configurable, e.g., 1.0 m/px).
*   **User Feedback**: Display a banner/toast: *"Using 1-point calibration (North-up). Add a second point to fix orientation and scale."*

### 2.3 Two+ GPS Points
*   **Standard Calibration**: Use the existing robust Similarity/Affine/Homography pipeline.
*   **Scale Harmonization**: If a manual `referenceDistance` is provided, it can be used to constrain the Similarity fit (Phase 2).

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
    const scale = userOptions.referenceScale || userOptions.defaultScale || 1.0;
    const rotation = userOptions.defaultRotation || 0;
    const model = fitSimilarity1Point(enrichedPairs[0], scale, rotation);
    return { ...model, origin, pairs: enrichedPairs };
  }
  // ...
}
```

### 3.3 UI Layer (`src/index.js`)
*   Update the "Live" button logic to enable when `state.pairs.length >= 1`.
*   Add a UI indicator when in "Fallback Mode" (1 point).
*   Allow configuration of `defaultScale` in settings (e.g., "Floorplan mode" vs "Map mode").

## 4. Edge Cases & Considerations
*   **Unstable 2-Point Fit**: If two GPS points are extremely close together, the rotation becomes numerically unstable. In this case, the system should either warn the user or offer to stick to the "North-up" assumption.
*   **Default Scale Choice**: 1.0 m/px is a safe neutral default, but 0.05 m/px (20 px/m) is better for architectural floorplans. We could auto-detect "Floorplan mode" if the user uses the "Set Scale" tool before adding GPS points.
