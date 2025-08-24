const { applyTransform } = require('./transform');
const { calibrate } = require('./robust');
const ErrorMetrics = require('./error-metrics');

const EARTH_RADIUS = 6378137;
const toRad = (d) => (d * Math.PI) / 180;

function latLonToEnu(lat, lon, origin) {
  const dLat = toRad(lat - origin.lat);
  const dLon = toRad(lon - origin.lon);
  const lat0 = toRad(origin.lat);
  return {
    x: EARTH_RADIUS * dLon * Math.cos(lat0),
    y: EARTH_RADIUS * dLat,
  };
}

class CalibrationModel {
  constructor() {
    this.pairs = [];
    this.baseKind = 'similarity';
    this.origin = null;
    this.transform = null;
    this.metrics = null;
  }

  setPairs(pairs) {
    this.pairs = pairs.map((p) => {
      if (!this.origin && p.wgs84) {
        this.origin = { lat: p.wgs84.lat, lon: p.wgs84.lon };
      }
      const enu = p.enu
        ? p.enu
        : p.wgs84 && this.origin
        ? latLonToEnu(p.wgs84.lat, p.wgs84.lon, this.origin)
        : p.world;
      return { pixel: p.pixel, world: enu };
    });
  }

  setBaseKind(kind) {
    this.baseKind = kind;
  }

  fitRobust(config = {}) {
    const { model, residuals } = calibrate(this.pairs, {
      ...config,
      modelType: this.baseKind,
    });
    this.transform = model;
    this.metrics = new ErrorMetrics(model, this.pairs);
    const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
    const maxResidual = Math.max(...residuals);
    return { model, residuals, rmse, maxResidual };
  }

  enableTPS(lambda) {
    this.tps = { lambda };
  }

  disableTPS() {
    this.tps = null;
  }

  projectLatLonToPixel(lat, lon) {
    if (!this.transform) throw new Error('Model not fitted');
    if (!this.origin) throw new Error('Origin not set');
    const enu = latLonToEnu(lat, lon, this.origin);
    return applyTransform(this.transform, enu);
  }
}

module.exports = CalibrationModel;
