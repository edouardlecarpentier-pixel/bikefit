import {
  angleDeg, detectBottoms, median, spread, percentile, rate, RANGES, verdict, saddleDeltaMm, saddleFormulas,
} from './analysis.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const $ = (id) => document.getElementById(id);
const BODY_SECONDS = 6;
const SADDLE_CYCLES = 8;

// ---------- stockage local ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* indisponible */ } },
};
let profile = { inseam: '', saddleNow: '', bike: 'Specialized Creo 2', size: '', crank: 170, ...store.get('profile', {}) };
let history = store.get('history', []);
let result = { saddle: null, body: null };

const setStatus = (t) => { $('status').textContent = t; };

// ---------- profil (étape 1) ----------
const pFields = { inseam: 'pInseam', saddleNow: 'saddleNow', bike: 'pBike', size: 'pSize', crank: 'pCrank' };
function updateStart() {
  const v = parseFloat(profile.inseam);
  const okInseam = v > 40 && v < 120;
  $('startCard').hidden = !okInseam;
  if (okInseam) $('rLemond').textContent = saddleFormulas(v).lemond + ' mm';
}
for (const [k, id] of Object.entries(pFields)) {
  $(id).value = profile[k] ?? '';
  $(id).addEventListener('input', () => { profile[k] = $(id).value; store.set('profile', profile); updateStart(); });
}
updateStart();

// ---------- navigation par étapes ----------
let step = 1;
function goStep(n) {
  if (n !== step) stopAll();
  hideLive(2); hideLive(3);
  step = n;
  document.querySelectorAll('.step').forEach((s) => s.classList.remove('active'));
  $('s' + n).classList.add('active');
  document.querySelectorAll('#stepper i').forEach((d, i) => {
    d.className = i + 1 < n ? 'done' : i + 1 === n ? 'cur' : '';
  });
  if (n === 4) renderReport();
  window.scrollTo(0, 0);
  $('s' + n).scrollIntoView?.({ block: 'start' });
}
goStep(1);
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goStep(+b.dataset.go)));
$('next1').addEventListener('click', () => {
  if (!(parseFloat(profile.inseam) > 40)) setStatus('Sans entrejambe : pas d\'estimation en mm');
  else setStatus('');
  goStep(2);
});
$('btnHisto').addEventListener('click', () => { stopAll(); renderHisto(); document.querySelectorAll('.step').forEach((s) => s.classList.remove('active')); $('sH').classList.add('active'); });
$('closeH').addEventListener('click', () => goStep(step));

// ---------- installation PWA ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; });
$('btnInstall').addEventListener('click', () => { if (installEvt) { installEvt.prompt(); installEvt = null; $('btnInstall').hidden = true; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- caméra / pose ----------
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
let landmarker = null, stream = null, facing = 'environment', running = false, wakeLock = null, mode = null;
let samples = [], bottoms = [], lastBottomKnee = NaN, segs = { thigh: NaN, shank: NaN };
let bodySamples = [], lastVideoTime = -1, lastRender = 0;

const R = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };
const L = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };

async function loadModel() {
  if (landmarker) return;
  setStatus('Chargement du modèle…');
  const { PoseLandmarker, FilesetResolver } = await import(MP);
  const fileset = await FilesetResolver.forVisionTasks(MP + '/wasm');
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1 });
  try { landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch { landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
  setStatus('');
}

function showLive(n) {
  $('intro' + n).hidden = true;
  $('live' + n).hidden = false;
  $('slot' + n).append($('cam'));
  $('cam').hidden = false;
}
function hideLive(n) {
  $('intro' + n).hidden = false;
  $('live' + n).hidden = true;
  $('cam').hidden = true;
}

async function startSession(n, file) {
  stopAll();
  mode = n === 2 ? 'saddle' : 'body';
  samples = []; bottoms = []; lastBottomKnee = NaN; bodySamples = []; lastVideoTime = -1;
  showLive(n);
  setMsg('Chargement…');
  try {
    await loadModel();
    if (file) {
      video.srcObject = null;
      video.src = URL.createObjectURL(file);
      video.loop = true;
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      video.srcObject = stream;
    }
    video.muted = true;
    await video.play();
    running = true;
    setMsg('Pédale normalement…');
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => (wakeLock = w)).catch(() => {});
    requestAnimationFrame(loop);
  } catch (e) {
    hideLive(n);
    setStatus('Caméra indisponible : ' + (e.message || e.name) + '. Autorise la caméra ou importe une vidéo.');
  }
}

function stopAll() {
  running = false;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  video.pause();
  if (video.src) { URL.revokeObjectURL(video.src); video.removeAttribute('src'); }
  video.srcObject = null;
  video.loop = false;
}

const setMsg = (t) => { $('msg' + (mode === 'body' ? 3 : 2)).textContent = t; };

$('start2').addEventListener('click', () => startSession(2));
$('file2').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) startSession(2, f); });
$('start3').addEventListener('click', () => startSession(3));
$('skip3').addEventListener('click', () => { result.body = null; goStep(4); });
$('btnStop').addEventListener('click', () => { stopAll(); hideLive(step); });
$('btnFlip').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; if (stream) startSession(step); });

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
  if (canvas.width !== vw) { canvas.width = vw; canvas.height = vh; }
  const res = landmarker.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, vw, vh);
  const lm = res.landmarks && res.landmarks[0];
  if (!lm) { setMsg('Personne détectée : place-toi bien de profil dans le cadre'); return; }
  process(lm, vw, vh);
}

function process(lm, vw, vh) {
  const vis = (m) => Object.values(m).reduce((s, i) => s + (lm[i].visibility ?? 0), 0) / 6;
  const sel = $('side').value;
  const idx = sel === 'right' ? R : sel === 'left' ? L : vis(R) >= vis(L) ? R : L;
  const P = Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, { x: lm[i].x * vw, y: lm[i].y * vh }]));
  draw(P, vw);
  if (vis(idx) < 0.4) { setMsg('Corps non visible en entier : recule ou recadre'); return; }

  const t = performance.now() / 1000;
  const knee = angleDeg(P.hip, P.knee, P.ankle);
  const hip = angleDeg(P.shoulder, P.hip, P.knee);
  const elbow = angleDeg(P.shoulder, P.elbow, P.wrist);
  const back = (Math.atan2(Math.abs(P.shoulder.y - P.hip.y), Math.abs(P.shoulder.x - P.hip.x)) * 180) / Math.PI;

  if (mode === 'saddle') {
    samples.push({ t, ankleY: P.ankle.y, knee });
    while (samples.length && t - samples[0].t > 8) samples.shift();
    segs = {
      thigh: Math.hypot(P.hip.x - P.knee.x, P.hip.y - P.knee.y),
      shank: Math.hypot(P.knee.x - P.ankle.x, P.knee.y - P.ankle.y),
    };
    bottoms = detectBottoms(samples);
    const recent = bottoms.slice(-SADDLE_CYCLES).map((b) => b.knee);
    lastBottomKnee = recent.length >= 3 ? median(recent) : NaN;
    renderSaddle(recent);
  } else {
    bodySamples.push({ t, hip, back, elbow });
    renderBody();
  }
}

function draw(P, vw) {
  ctx.lineWidth = Math.max(3, vw / 220);
  ctx.strokeStyle = '#22d3ee';
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.moveTo(P.shoulder.x, P.shoulder.y);
  for (const k of ['hip', 'knee', 'ankle']) ctx.lineTo(P[k].x, P[k].y);
  ctx.moveTo(P.shoulder.x, P.shoulder.y);
  ctx.lineTo(P.elbow.x, P.elbow.y);
  ctx.lineTo(P.wrist.x, P.wrist.y);
  ctx.stroke();
  for (const p of Object.values(P)) { ctx.beginPath(); ctx.arc(p.x, p.y, ctx.lineWidth * 1.6, 0, 7); ctx.fill(); }
}

const throttle = () => { const n = performance.now(); if (n - lastRender < 150) return true; lastRender = n; return false; };
const fmt = (v, u = '°') => (Number.isFinite(v) ? Math.round(v) + u : '–');

function currentDelta() {
  const inseam = parseFloat(profile.inseam);
  if (!(inseam > 40)) return NaN;
  return saddleDeltaMm(segs.thigh, segs.shank, lastBottomKnee, inseam * 10 * 0.95);
}

function renderSaddle(recent) {
  if (throttle()) return;
  const n = bottoms.length;
  const ready = recent.length >= SADDLE_CYCLES && spread(recent) <= 6;
  const v = verdict(lastBottomKnee);
  $('verdict').className = 'verdict ' + v.code;
  $('verdict').textContent = Number.isFinite(lastBottomKnee) ? `${v.text} · genou ${fmt(lastBottomKnee)}` : v.text;
  $('bar2').style.width = Math.min(100, (n / SADDLE_CYCLES) * 100) + '%';
  $('val2').disabled = !(recent.length >= 3);
  setMsg(ready ? 'Mesure stable ✓ tu peux valider' : `Cycles analysés : ${Math.min(n, SADDLE_CYCLES)} / ${SADDLE_CYCLES}`);
}

function renderBody() {
  if (throttle()) return;
  const secs = bodySamples.length ? bodySamples[bodySamples.length - 1].t - bodySamples[0].t : 0;
  const b = summarizeBody();
  $('mHip').textContent = fmt(b.hip);
  $('mBack').textContent = fmt(b.back);
  $('mElbow').textContent = fmt(b.elbow);
  $('bar3').style.width = Math.min(100, (secs / BODY_SECONDS) * 100) + '%';
  const ready = secs >= BODY_SECONDS && bodySamples.length > 40;
  $('val3').disabled = !ready;
  setMsg(ready ? 'Mesure terminée ✓ tu peux valider' : 'Pédale en position habituelle…');
}

function summarizeBody() {
  const hips = bodySamples.map((s) => s.hip);
  return {
    hip: percentile(hips, 10), // angle le plus fermé au haut du coup de pédale
    back: median(bodySamples.map((s) => s.back)),
    elbow: median(bodySamples.map((s) => s.elbow)),
  };
}

$('val2').addEventListener('click', () => {
  if (!Number.isFinite(lastBottomKnee)) return;
  const v = verdict(lastBottomKnee);
  result.saddle = {
    knee: Math.round(lastBottomKnee * 10) / 10,
    flexion: Math.round(v.flexion * 10) / 10,
    code: v.code,
    text: v.text,
    delta: currentDelta(),
  };
  goStep(3);
});
$('val3').addEventListener('click', () => { result.body = summarizeBody(); goStep(4); });

// ---------- bilan (étape 4) ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function card(cls, label, hint, value) {
  const c = el('div', 'card ' + cls);
  const l = el('div');
  l.append(el('span', null, label));
  if (hint) l.append(el('small', null, hint));
  c.append(l, el('b', null, value));
  return c;
}
const BODY_HINTS = {
  hip: { low: 'Hanche très fermée : relève un peu le buste ou le guidon', high: 'Hanche très ouverte', ok: 'Dans la plage' },
  back: { low: 'Buste très penché', high: 'Buste très redressé', ok: 'Dans la plage' },
  elbow: { low: 'Bras très fléchis', high: 'Bras tendus : recule ou raccourcis la potence', ok: 'Dans la plage' },
};

function recommendation() {
  const s = result.saddle;
  if (!s) return { cls: '', text: 'Mesure de selle non faite.' };
  if (s.code === 'ok') return { cls: 'ok', text: 'Hauteur de selle correcte : ne change rien.' };
  const up = s.code === 'low';
  if (Number.isFinite(s.delta)) {
    const mm = Math.round(Math.abs(s.delta));
    const now = parseFloat(profile.saddleNow);
    const target = now > 0 ? ` (≈ ${Math.round(now + s.delta)} mm)` : '';
    return { cls: '', text: `${up ? 'Monte' : 'Descends'} la selle d'environ ${mm} mm${target}.` };
  }
  return { cls: '', text: `${up ? 'Monte' : 'Descends'} la selle de quelques mm, puis refais la mesure.` };
}

function renderReport() {
  const box = $('report');
  box.textContent = '';
  const reco = recommendation();
  box.append(el('div', 'reco ' + reco.cls, reco.text));
  const s = result.saddle;
  if (s) box.append(card(s.code, 'Genou au point bas', `${s.text} · flexion ${Math.round(s.flexion)}° (cible 25–35°)`, Math.round(s.knee) + '°'));
  const b = result.body;
  if (b) {
    for (const [k, label] of [['hip', 'Hanche (haut du coup de pédale)'], ['back', 'Dos / horizontale'], ['elbow', 'Coude']]) {
      const r = rate(b[k], RANGES[k]);
      box.append(card(r, label, BODY_HINTS[k][r] || '', fmt(b[k])));
    }
    box.append(el('p', 'muted', 'Plages indicatives (route endurance), à adapter à ta souplesse et à ton confort.'));
  } else {
    box.append(el('p', 'muted', 'Haut du corps non mesuré.'));
  }
  box.append(el('p', 'muted', 'Après réglage, utilise « Refaire la mesure » pour vérifier.'));
}

function reportText() {
  const s = result.saddle, b = result.body;
  const lines = [`BikeFit – ${profile.bike || 'vélo'} – ${new Date().toLocaleDateString('fr-FR')}`];
  if (profile.saddleNow) lines.push(`Hauteur de selle : ${profile.saddleNow} mm`);
  if (s) lines.push(`Genou au point bas : ${Math.round(s.knee)}° (flexion ${Math.round(s.flexion)}°) – ${s.text}`);
  lines.push(recommendation().text);
  if (b) lines.push(`Hanche ${fmt(b.hip)}, dos ${fmt(b.back)}, coude ${fmt(b.elbow)}`);
  return lines.join('\n');
}

$('save4').addEventListener('click', () => {
  if (!result.saddle && !result.body) { setStatus('Rien à enregistrer'); return; }
  history.unshift({
    id: Date.now(), date: new Date().toISOString(), bike: profile.bike,
    saddleNow: parseFloat(profile.saddleNow) || null,
    saddle: result.saddle, body: result.body, reco: recommendation().text,
  });
  store.set('history', history);
  setStatus('Bilan enregistré ✓');
});
$('copy4').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(reportText()); setStatus('Bilan copié ✓'); } catch { setStatus('Copie impossible'); }
});
$('redo4').addEventListener('click', () => {
  result = { saddle: null, body: null };
  setStatus('Mets à jour ta hauteur de selle, puis recommence');
  goStep(1);
});

// ---------- historique ----------
function renderHisto() {
  const box = $('histo');
  box.textContent = '';
  if (!history.length) { box.append(el('p', 'muted', 'Aucun bilan enregistré.')); return; }
  for (const h of history) {
    const d = el('div', 'entry');
    const info = el('div');
    info.append(el('b', null, h.reco || '–'));
    const bits = [new Date(h.date).toLocaleString('fr-FR'), h.saddleNow ? `selle ${h.saddleNow} mm` : null,
      h.saddle ? `genou ${Math.round(h.saddle.knee)}°` : null,
      h.body ? `dos ${fmt(h.body.back)}, coude ${fmt(h.body.elbow)}` : null].filter(Boolean);
    info.append(el('small', null, bits.join(' · ')));
    const del = el('button', null, '✕');
    del.addEventListener('click', () => { history = history.filter((x) => x.id !== h.id); store.set('history', history); renderHisto(); });
    d.append(info, del);
    box.append(d);
  }
}

$('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ profile, history }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bikefit-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('importIn').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.history)) throw new Error('format');
    history = data.history.filter((h) => h && typeof h.id === 'number');
    store.set('history', history);
    if (data.profile && typeof data.profile === 'object') {
      profile = { ...profile, ...data.profile };
      store.set('profile', profile);
      for (const [k, id] of Object.entries(pFields)) $(id).value = profile[k] ?? '';
      updateStart();
    }
    renderHisto();
    setStatus('Import réussi ✓');
  } catch { setStatus('Fichier invalide'); }
});
$('btnClear').addEventListener('click', () => {
  if (confirm('Effacer tout l\'historique ?')) { history = []; store.set('history', history); renderHisto(); }
});
