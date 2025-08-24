const { applyTransform } = require('./transform');
const { distance } = require('./robust');

class ErrorMetrics {
  constructor(model, pairs) {
    this.model = model;
    this.pairs = pairs;
  }

  localRMSE(px) {
    if (!this.pairs.length) return 0;
    const weights = [];
    const errs = [];
    for (const p of this.pairs) {
      const proj = applyTransform(this.model, p.world);
      const res = distance(proj, p.pixel);
      const d = Math.hypot(px.x - proj.x, px.y - proj.y) + 1;
      weights.push(1 / d);
      errs.push(res);
    }
    let num = 0;
    let den = 0;
    for (let i = 0; i < errs.length; i++) {
      num += weights[i] * errs[i] * errs[i];
      den += weights[i];
    }
    return Math.sqrt(num / den);
  }

  heatmap(samples) {
    return Float32Array.from(samples.map((s) => this.localRMSE(s)));
  }
}

module.exports = ErrorMetrics;
