/**
 * @file src/util/coords.js
 * @description Handles coordinate system conversions, primarily between WGS84 (lat/lon)
 * and a local ENU (East, North, Up) tangent plane for stable numerical calculations.
 */

// WGS84 ellipsoid parameters
const a = 6378137.0; // Semi-major axis
const f = 1 / 298.257223563; // Flattening
const b = a * (1 - f); // Semi-minor axis
const e2 = f * (2 - f); // Eccentricity squared

/**
 * Converts Geodetic coordinates (latitude, longitude, altitude) to
 * Earth-Centered, Earth-Fixed (ECEF) coordinates.
 * @param {number} lat - Latitude in degrees.
 * @param {number} lon - Longitude in degrees.
 * @param {number} alt - Altitude in meters (optional, defaults to 0).
 * @returns {{x: number, y: number, z: number}} ECEF coordinates in meters.
 */
function wgs84ToEcef(lat, lon, alt = 0) {
  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);

  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);

  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);

  const x = (N + alt) * cosLat * Math.cos(lonRad);
  const y = (N + alt) * cosLat * Math.sin(lonRad);
  const z = ((b * b / (a * a)) * N + alt) * sinLat;

  return { x, y, z };
}

/**
 * Converts ECEF coordinates to a local East, North, Up (ENU) tangent plane.
 * @param {{x: number, y: number, z: number}} ecef - ECEF coordinates.
 * @param {{lat: number, lon: number, alt: number}} origin - The origin of the ENU plane in WGS84.
 * @returns {{x: number, y: number, z: number}} ENU coordinates in meters.
 */
function ecefToEnu(ecef, origin) {
  const originEcef = wgs84ToEcef(origin.lat, origin.lon, origin.alt);

  const dx = ecef.x - originEcef.x;
  const dy = ecef.y - originEcef.y;
  const dz = ecef.z - originEcef.z;

  const latRad = origin.lat * (Math.PI / 180);
  const lonRad = origin.lon * (Math.PI / 180);

  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  const e = -sinLon * dx + cosLon * dy;
  const n = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const u = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  return { x: e, y: n, z: u };
}

/**
 * Projects a WGS84 point to a local ENU plane defined by an origin.
 * This is the main function to be used by other modules.
 * @param {{lat: number, lon: number}} point - The WGS84 point to project.
 * @param {{lat: number, lon: number}} origin - The WGS84 origin of the ENU plane.
 * @returns {{x: number, y: number}} The projected ENU coordinates (2D).
 */
export function projectToEnu(point, origin) {
  const ecefPoint = wgs84ToEcef(point.lat, point.lon);
  const enuPoint = ecefToEnu(ecefPoint, { ...origin, alt: 0 });
  return { x: enuPoint.x, y: enuPoint.y };
}

/**
 * Converts ENU coordinates back to ECEF, relative to an origin.
 * @param {{x: number, y: number, z: number}} enu - The ENU coordinates.
 * @param {{lat: number, lon: number, alt: number}} origin - The WGS84 origin of the ENU plane.
 * @returns {{x: number, y: number, z: number}} ECEF coordinates.
 */
function enuToEcef(enu, origin) {
  const originEcef = wgs84ToEcef(origin.lat, origin.lon, origin.alt);

  const latRad = origin.lat * (Math.PI / 180);
  const lonRad = origin.lon * (Math.PI / 180);

  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  const dx = -sinLon * enu.x - sinLat * cosLon * enu.y + cosLat * cosLon * enu.z;
  const dy = cosLon * enu.x - sinLat * sinLon * enu.y + cosLat * sinLon * enu.z;
  const dz = cosLat * enu.y + sinLat * enu.z;

  return {
    x: originEcef.x + dx,
    y: originEcef.y + dy,
    z: originEcef.z + dz,
  };
}

/**
 * Converts ECEF coordinates to Geodetic coordinates (latitude, longitude, altitude).
 * This is an iterative and complex algorithm.
 * @param {{x: number, y: number, z: number}} ecef - ECEF coordinates.
 * @returns {{lat: number, lon: number, alt: number}} WGS84 coordinates.
 */
function ecefToWgs84(ecef) {
  const { x, y, z } = ecef;
  const p = Math.sqrt(x * x + y * y);
  const lon = Math.atan2(y, x);

  let lat = Math.atan2(z, p * (1 - e2));
  let alt = 0;
  let N = 0;

  for (let i = 0; i < 5; i++) { // Iterate a few times for convergence
    const sinLat = Math.sin(lat);
    N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    alt = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - e2 * N / (N + alt)));
  }

  return {
    lat: lat * (180 / Math.PI),
    lon: lon * (180 / Math.PI),
    alt: alt,
  };
}

/**
 * Un-projects a 2D ENU point back to WGS84, relative to an origin.
 * @param {{x: number, y: number}} point - The ENU point.
 * @param {{lat: number, lon: number}} origin - The WGS84 origin of the ENU plane.
 * @returns {{lat: number, lon: number}} The un-projected WGS84 coordinates.
 */
export function unprojectFromEnu(point, origin) {
  // Assume z (up) is 0 for the 2D to 3D conversion
  const enuPoint = { x: point.x, y: point.y, z: 0 };
  const ecefPoint = enuToEcef(enuPoint, { ...origin, alt: 0 });
  const wgs84Point = ecefToWgs84(ecefPoint);
  return { lat: wgs84Point.lat, lon: wgs84Point.lon };
}
