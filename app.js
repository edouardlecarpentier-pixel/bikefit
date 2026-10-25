import { angleDeg, detectBottoms, median, verdict, saddleDeltaMm, saddleFormulas } from './analysis.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const $ = (id) => document.getElementById(id);

// ---------- stockage local ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
let profile = store.get('profile', { inseam: '', bike: 'Specialized Creo 2', size: '', crank: 170 });
let history = store.get('history', []);

// ---------- onglets ----------
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  })
);

// ---------- profil ----------
const pFields = { inseam: 'pInseam', bike: 'pBike', size: 'pSize', crank: 'pCrank' };
for (const [k, id] of Object.entries(pFields)) {
  $(id).value = profile[k] ?? '';
  $(id).addEventListener('input', () => { profile[k] = $(id).value; store.set('profile', profile); updateCalc(); });
}
$('inseamCalc').value = profile.inseam;
$('inseamCalc').addEventListener('input', () => { $('pInseam').value = profile.inseam = $('inseamCalc').value; store.set('profile', profile); updateCalc(); });
function updateCalc() {
  const v = parseFloat(profile.inseam);
  $('inseamCalc').value = profile.inseam;
  if (!(v > 40 && v < 120)) { $('rLemond').textContent = $('rHamley').textContent = '–'; return; }
  const f = saddleFormulas(v);
  $('rLemond').textContent = f.lemond + ' mm';
  $('rHamley').textContent = f.hamley + ' mm';
}
updateCalc();

// ---------- installation PWA ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; });
$('btnInstall').addEventListener('click', async () => { if (installEvt) { installEvt.prompt(); installEvt = null; $('btnInstall').hidden = true; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- pose ----------
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
let landmarker = null, stream = null, facing = 'environment', running = false, wakeLock = null;
let samples = [], bottoms = [], lastBottomKnee = NaN, segs = { thigh: NaN, shank: NaN };

const R = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };
const L = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };

async function loadModel() {
  if (landmarker) return landmarker;
  setStatus('Chargement du modèle…');
  const { PoseLandmarker, FilesetResolver } = await import(MP);
  const fileset = await FilesetResolver.forVisionTasks(MP + '/wasm');
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1 });
  try { landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch { landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
  setStatus('Modèle prêt');
  return landmarker;
}

function setStatus(t) { $('status').textContent = t; }

async function startCamera() {
  stopAll();
  try {
    await loadModel();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    begin('Caméra active');
  } catch (e) {
    setStatus('Erreur : ' + (e.message || e.name));
    $('hint').textContent = 'Caméra indisponible. Autorise la caméra (HTTPS requis) ou importe une vidéo.';
  }
}

async function startFile(file) {
  stopAll();
  try {
    await loadModel();
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.loop = true;
    await video.play();
    begin('Analyse de la vidéo');
  } catch (e) { setStatus('Erreur : ' + (e.message || e.name)); }
}

function begin(msg) {
  samples = []; bottoms = []; lastBottomKnee = NaN;
  running = true;
  $('hint').style.display = 'none';
  $('btnCam').textContent = 'Arrêter';
  setStatus(msg);
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => (wakeLock = w)).catch(() => {});
  requestAnimationFrame(loop);
}

function stopAll() {
  running = false;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  video.pause();
  if (video.src) { URL.revokeObjectURL(video.src); video.removeAttribute('src'); }
  video.srcObject = null;
  video.loop = false;
  $('btnCam').textContent = 'Démarrer la caméra';
}

$('btnCam').addEventListener('click', () => (running ? (stopAll(), setStatus('Arrêté')) : startCamera()));
$('btnFlip').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; if (running && stream) startCamera(); });
$('fileIn').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) startFile(f); e.target.value = ''; });

let lastVideoTime = -1;
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
  if (!lm) return;
  process(lm, vw, vh);
}

function process(lm, vw, vh) {
  const vis = (m) => m.reduce((s, i) => s + (lm[i].visibility ?? 0), 0);
  const sideSel = $('side').value;
  const idx = sideSel === 'right' ? R : sideSel === 'left' ? L
    : vis(Object.values(R)) >= vis(Object.values(L)) ? R : L;
  const P = Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, { x: lm[i].x * vw, y: lm[i].y * vh }]));

  const knee = angleDeg(P.hip, P.knee, P.ankle);
  const hip = angleDeg(P.shoulder, P.hip, P.knee);
  const elbow = angleDeg(P.shoulder, P.elbow, P.wrist);
  const back = Math.abs((Math.atan2(P.shoulder.y - P.hip.y, Math.abs(P.shoulder.x - P.hip.x)) * 180) / Math.PI); // angle du dos / horizontale

  draw(P, vw);
  const t = performance.now() / 1000;
  samples.push({ t, ankleY: P.ankle.y, knee });
  while (samples.length && t - samples[0].t > 8) samples.shift();

  const thigh = Math.hypot(P.hip.x - P.knee.x, P.hip.y - P.knee.y);
  const shank = Math.hypot(P.knee.x - P.ankle.x, P.knee.y - P.ankle.y);
  segs = { thigh, shank };

  bottoms = detectBottoms(samples);
  const recent = bottoms.slice(-8).map((b) => b.knee);
  lastBottomKnee = recent.length >= 3 ? median(recent) : NaN;
  render({ hip, back, elbow, cycles: bottoms.length });
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

const fmt = (v, u = '°') => (Number.isFinite(v) ? Math.round(v) + u : '–');
let lastRender = 0;
function render({ hip, back, elbow, cycles }) {
  const now = performance.now();
  if (now - lastRender < 150) return;
  lastRender = now;
  const v = verdict(lastBottomKnee);
  const inseam = parseFloat(profile.inseam);
  const legMm = inseam > 40 ? inseam * 10 * 0.95 : NaN; // longueur hanche-cheville estimée
  const delta = Number.isFinite(legMm) ? saddleDeltaMm(segs.thigh, segs.shank, lastBottomKnee, legMm) : NaN;
  $('verdict').className = 'verdict ' + v.code;
  $('verdict').textContent = v.text;
  $('mKnee').textContent = fmt(lastBottomKnee);
  $('mFlex').textContent = fmt(v.flexion);
  $('mDelta').textContent = Number.isFinite(delta) ? (delta > 0 ? '+' : '') + Math.round(delta) + ' mm' : '–';
  $('mCycles').textContent = cycles;
  $('mHip').textContent = fmt(hip);
  $('mBack').textContent = fmt(back);
  $('mElbow').textContent = fmt(elbow);
}

// ---------- historique ----------
$('btnSave').addEventListener('click', () => {
  if (!Number.isFinite(lastBottomKnee)) { setStatus('Pas encore de mesure fiable'); return; }
  const v = verdict(lastBottomKnee);
  history.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    saddle: parseFloat($('saddleNow').value) || null,
    knee: Math.round(lastBottomKnee * 10) / 10,
    flexion: Math.round(v.flexion * 10) / 10,
    verdict: v.text,
    delta: $('mDelta').textContent,
    bike: profile.bike,
  });
  store.set('history', history);
  renderHisto();
  setStatus('Mesure enregistrée');
});

function renderHisto() {
  const box = $('histo');
  box.textContent = '';
  if (!history.length) { box.innerHTML = '<p class="muted">Aucune mesure enregistrée.</p>'; return; }
  for (const h of history) {
    const d = document.createElement('div');
    d.className = 'entry';
    const info = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = `${h.verdict} · genou ${h.knee}° (flexion ${h.flexion}°)`;
    const s = document.createElement('small');
    s.textContent = `${new Date(h.date).toLocaleString('fr-FR')} · selle ${h.saddle ? h.saddle + ' mm' : 'n/a'} · ajustement ${h.delta} · ${h.bike || ''}`;
    info.append(b, s);
    const del = document.createElement('button');
    del.textContent = '✕';
    del.addEventListener('click', () => { history = history.filter((x) => x.id !== h.id); store.set('history', history); renderHisto(); });
    d.append(info, del);
    box.append(d);
  }
}
renderHisto();

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
    if (data.profile && typeof data.profile === 'object') { profile = { ...profile, ...data.profile }; store.set('profile', profile); for (const [k, id] of Object.entries(pFields)) $(id).value = profile[k] ?? ''; updateCalc(); }
    store.set('history', history);
    renderHisto();
    setStatus('Import réussi');
  } catch { setStatus('Fichier invalide'); }
});
$('btnClear').addEventListener('click', () => {
  if (confirm('Effacer tout l\'historique ?')) { history = []; store.set('history', history); renderHisto(); }
});
