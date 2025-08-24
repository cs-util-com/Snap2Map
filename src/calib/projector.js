class PositionProjector {
  setCalibration(model) {
    this.model = model;
  }

  toPixel(pos) {
    if (!this.model) throw new Error('Calibration not set');
    const px = this.model.projectLatLonToPixel(pos.lat, pos.lon);
    const sigmaMap = this.model.metrics ? this.model.metrics.localRMSE(px) : 0;
    const acc = pos.accuracy || 0;
    const sigmaTotal = Math.sqrt(acc * acc + sigmaMap * sigmaMap);
    return { px, sigmaMap, sigmaTotal };
  }
}

module.exports = PositionProjector;
