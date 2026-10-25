// Logique pure de bike fit : angles, détection des points bas de pédalage, verdict.

export const TARGET_FLEXION = 30; // flexion du genou visée au point bas (plage 25-35°)
export const FLEXION_MIN = 25;
export const FLEXION_MAX = 35;

export function angleDeg(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!n) return NaN;
  const cos = (v1.x * v2.x + v1.y * v2.y) / n;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export function median(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// samples: [{ t (s), ankleY (px, vers le bas = grand), knee (angle interne, deg) }]
// Renvoie, pour chaque coup de pédale, l'extension max du genou autour du point bas de la cheville.
export function detectBottoms(samples, { minGap = 0.35, window = 0.18, minRange = 8 } = {}) {
  if (samples.length < 5) return [];
  const ys = samples.map((s) => s.ankleY);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  if (hi - lo < minRange) return []; // pas de pédalage détecté
  const thr = lo + (hi - lo) * 0.7;
  const bottoms = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const y = samples[i].ankleY;
    if (y < thr || y < samples[i - 1].ankleY || y <= samples[i + 1].ankleY) continue;
    const last = bottoms[bottoms.length - 1];
    if (last && samples[i].t - samples[last].t < minGap) {
      if (y > samples[last].ankleY) bottoms[bottoms.length - 1] = i;
      continue;
    }
    bottoms.push(i);
  }
  return bottoms
    .map((i) => {
      const t0 = samples[i].t;
      const ks = samples
        .filter((s) => Math.abs(s.t - t0) <= window && Number.isFinite(s.knee))
        .map((s) => s.knee);
      return ks.length ? { t: t0, knee: Math.max(...ks) } : null;
    })
    .filter(Boolean);
}

export function spread(arr) {
  const a = arr.filter(Number.isFinite);
  return a.length ? Math.max(...a) - Math.min(...a) : NaN;
}

export function percentile(arr, p) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))];
}

// Plages indicatives (route endurance). Renvoie 'ok' | 'low' | 'high' | 'none'.
export const RANGES = { back: [35, 55], elbow: [145, 170], hip: [40, 80] };
export function rate(value, [lo, hi]) {
  if (!Number.isFinite(value)) return 'none';
  return value < lo ? 'low' : value > hi ? 'high' : 'ok';
}

export function verdict(kneeInterior) {
  if (!Number.isFinite(kneeInterior)) return { code: 'none', flexion: NaN, text: 'En attente de pédalage…' };
  const flexion = 180 - kneeInterior;
  if (flexion < FLEXION_MIN) return { code: 'high', flexion, text: 'Selle trop haute' };
  if (flexion > FLEXION_MAX) return { code: 'low', flexion, text: 'Selle trop basse' };
  return { code: 'ok', flexion, text: 'Hauteur de selle correcte' };
}

// Variation de hauteur de selle (mm, + = monter) pour ramener la flexion à TARGET_FLEXION.
// thigh/shank : longueurs en px (même unité). legMm : longueur hanche-cheville étendue estimée (mm).
export function saddleDeltaMm(thigh, shank, kneeInterior, legMm) {
  const total = thigh + shank;
  if (!(total > 0) || !Number.isFinite(kneeInterior)) return NaN;
  const a = thigh / total;
  const b = shank / total;
  const dist = (deg) => Math.sqrt(a * a + b * b - 2 * a * b * Math.cos((deg * Math.PI) / 180));
  return (dist(180 - TARGET_FLEXION) - dist(kneeInterior)) * legMm;
}

// Hauteurs de selle théoriques (mm). inseamCm = entrejambe.
export function saddleFormulas(inseamCm) {
  return {
    lemond: Math.round(inseamCm * 10 * 0.883), // axe de pédalier -> dessus de selle
    hamley: Math.round(inseamCm * 10 * 1.09), // axe de pédale -> dessus de selle
  };
}
