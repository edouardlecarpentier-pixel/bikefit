import assert from 'node:assert/strict';
import { angleDeg, detectBottoms, median, verdict, saddleDeltaMm, saddleFormulas } from '../analysis.js';

// angle
assert.ok(Math.abs(angleDeg({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }) - 90) < 1e-9);
assert.ok(Math.abs(angleDeg({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }) - 180) < 1e-9);

// pédalage simulé : 90 rpm, 30 fps, 6 s ; genou 150° au point bas, 75° en haut
function simulate(bottomKnee) {
  const s = [];
  for (let i = 0; i < 180; i++) {
    const t = i / 30;
    const ph = 2 * Math.PI * 1.5 * t; // 1.5 Hz
    const c = (1 + Math.cos(ph - Math.PI)) / 2; // 1 au point bas
    s.push({ t, ankleY: 500 + 60 * (c - 0.5), knee: 75 + (bottomKnee - 75) * c });
  }
  return s;
}
const bottoms = detectBottoms(simulate(150));
assert.ok(bottoms.length >= 7 && bottoms.length <= 10, `cycles: ${bottoms.length}`);
assert.ok(Math.abs(median(bottoms.map((b) => b.knee)) - 150) < 1.5);

// immobile : aucun cycle
assert.equal(detectBottoms(simulate(150).map((s) => ({ ...s, ankleY: 500 }))).length, 0);

// verdict
assert.equal(verdict(150).code, 'ok'); // flexion 30
assert.equal(verdict(170).code, 'high'); // flexion 10
assert.equal(verdict(135).code, 'low'); // flexion 45
assert.equal(verdict(NaN).code, 'none');

// delta : trop bas (genou 135°) -> monter ; trop haut (170°) -> descendre ; ok -> ~0
assert.ok(saddleDeltaMm(450, 450, 135, 800) > 0);
assert.ok(saddleDeltaMm(450, 450, 170, 800) < 0);
assert.ok(Math.abs(saddleDeltaMm(450, 450, 150, 800)) < 1e-6);

// formules
assert.deepEqual(saddleFormulas(80), { lemond: 706, hamley: 872 });

console.log('OK : tous les tests passent');
