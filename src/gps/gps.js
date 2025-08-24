/**
 * @file src/gps/gps.js
 * @description Handles GPS position tracking using the Geolocation API.
 */

let watchId = null;

/**
 * Starts watching the user's GPS position.
 * @param {function(GeolocationPosition)} successCallback - Called with the position object on success.
 * @param {function(GeolocationPositionError)} errorCallback - Called with the error object on failure.
 * @returns {boolean} True if watching was started, false if already watching or not supported.
 */
export function startWatchingPosition(successCallback, errorCallback) {
  if (!navigator.geolocation) {
    console.error("Geolocation is not supported by this browser.");
    if (errorCallback) {
      errorCallback({
        code: 0,
        message: "Geolocation is not supported by this browser.",
      });
    }
    return false;
  }

  if (watchId !== null) {
    console.warn("Position watching is already active.");
    return false;
  }

  const options = {
    enableHighAccuracy: true,
    timeout: 10000, // 10 seconds
    maximumAge: 0,
  };

  console.log("Starting to watch position...");
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      console.log('New position received:', position.coords);
      successCallback(position);
    },
    (error) => {
      console.error("Error getting position:", error);
      if (errorCallback) {
        errorCallback(error);
      }
    },
    options
  );

  return true;
}

/**
 * Stops watching the user's GPS position.
 */
export function stopWatchingPosition() {
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    console.log("Stopped watching position.");
  }
}

/**
 * Gets a single high-accuracy position.
 * @param {{timeout: number, accuracyTarget: number}} options - The options for the request.
 * @returns {Promise<GeolocationPosition>} A promise that resolves with the position.
 */
export function getCurrentPosition(options = {}) {
  const { timeout = 30000, accuracyTarget = 10 } = options;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Geolocation is not supported."));
    }

    const timeoutId = setTimeout(() => {
      reject(new Error(`Could not get a position within ${timeout / 1000}s.`));
    }, timeout);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timeoutId);
        if (position.coords.accuracy <= accuracyTarget) {
          console.log(`Got position with sufficient accuracy: ${position.coords.accuracy}m`);
          resolve(position);
        } else {
          // For now, we resolve with the less accurate position.
          // A better implementation might watch for a while to get better accuracy.
          console.warn(`Got position, but accuracy (${position.coords.accuracy}m) is worse than target (${accuracyTarget}m).`);
          resolve(position);
        }
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}
