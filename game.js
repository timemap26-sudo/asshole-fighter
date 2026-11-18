'use strict';
/* 混蛋快打 Asshole Fighter — a one-sided fighting game.
   Upload a face, the opponent becomes a puppet that never fights back. */
(() => {
const W = 960, H = 540, GY = 478, TAU = Math.PI * 2, GRAV = 1500;
const $ = s => document.querySelector(s);
const canvas = $('#game'), mainCtx = canvas.getContext('2d');
let ctx = mainCtx; // swapped temporarily when drawing into offscreen layers
let DPR = 0;
function fitCanvas() {
  const d = Math.min(window.devicePixelRatio || 1, 2);
  if (d !== DPR) { DPR = d; canvas.width = W * d; canvas.height = H * d; }
}
fitCanvas();
addEventListener('resize', fitCanvas);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = t => 1 - (1 - t) * (1 - t);
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei','Heiti TC',sans-serif";

/* ------------------------------------------------------------------ audio */
let AC = null, master = null, noiseBuf = null;
function audio() {
  if (!AC) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    AC = new C();
    master = AC.createGain(); master.gain.value = 0.7; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function noise({ dur = 0.1, type = 'bandpass', freq = 1000, freqEnd = 0, q = 1, gain = 0.5, delay = 0 }) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + delay;
  const src = a.createBufferSource(); src.buffer = noiseBuf;
  const f = a.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
}
function tone({ f0 = 200, f1 = 60, dur = 0.2, type = 'sine', gain = 0.6, delay = 0 }) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const SFX = {
  slap() { noise({ dur: 0.08, type: 'highpass', freq: 1800, gain: 1 }); noise({ dur: 0.05, freq: 4500, q: 0.8, gain: 0.7 }); tone({ f0: 420, f1: 150, dur: 0.05, type: 'triangle', gain: 0.3 }); },
  punch() { tone({ f0: 170, f1: 45, dur: 0.16, gain: 0.9 }); noise({ dur: 0.09, type: 'lowpass', freq: 1200, gain: 0.7 }); },
  kick() { tone({ f0: 130, f1: 35, dur: 0.24, gain: 1 }); noise({ dur: 0.14, type: 'lowpass', freq: 900, gain: 0.8 }); },
  slam() { tone({ f0: 100, f1: 25, dur: 0.6, gain: 1 }); noise({ dur: 0.45, type: 'lowpass', freq: 600, freqEnd: 80, gain: 1 }); },
  thud() { tone({ f0: 90, f1: 40, dur: 0.15, gain: 0.6 }); noise({ dur: 0.1, type: 'lowpass', freq: 500, gain: 0.5 }); },
  whoosh() { noise({ dur: 0.14, freq: 600, freqEnd: 2600, q: 1.5, gain: 0.22 }); },
  grab() { noise({ dur: 0.06, freq: 1500, gain: 0.4 }); },
  superStart() { tone({ f0: 200, f1: 1200, dur: 0.5, type: 'sawtooth', gain: 0.22 }); noise({ dur: 0.6, freq: 400, freqEnd: 4000, gain: 0.3 }); },
  ko() { tone({ f0: 600, f1: 60, dur: 1.4, type: 'sawtooth', gain: 0.3 }); tone({ f0: 300, f1: 30, dur: 1.6, type: 'square', gain: 0.12, delay: 0.1 }); },
  glass() { for (let i = 0; i < 6; i++) tone({ f0: rand(2000, 5000), f1: rand(800, 2000), dur: 0.25, type: 'triangle', gain: 0.1, delay: i * 0.03 }); noise({ dur: 0.3, type: 'highpass', freq: 3000, gain: 0.5 }); },
};

/* ------------------------------------------------------------------ voice */
let voiceOn = true, zhVoice = null, lastSpeak = 0;
const hasTTS = 'speechSynthesis' in window;
function loadVoices() {
  if (!hasTTS) return;
  const vs = speechSynthesis.getVoices();
  zhVoice = vs.find(v => /zh[-_]TW/i.test(v.lang)) || vs.find(v => /zh[-_]HK/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
}
if (hasTTS) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(text, urgency = 0, force = false) {
  if (!voiceOn || !hasTTS) return;
  const now = performance.now();
  if (!force && now - lastSpeak < 1300) return;
  lastSpeak = now;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[…]/g, ','));
    u.lang = zhVoice ? zhVoice.lang : 'zh-TW';
    if (zhVoice) u.voice = zhVoice;
    u.pitch = clamp(1.15 + urgency * 0.7, 0, 2);
    u.rate = clamp(1.05 + urgency * 0.35, 0.5, 2);
    speechSynthesis.speak(u);
  } catch (e) { /* no voice, no problem */ }
}

/* ------------------------------------------------------------------ lines */
const BEG = [
  ['欸欸欸?你想幹嘛?', '冷靜一點好不好…', '有話好好說嘛!', '我、我可以解釋!', '別衝動啊大哥!'],
  ['好痛!不要打臉!', '對不起對不起!', '我錯了啦!', '拜託住手!', '我道歉還不行嗎!'],
  ['嗚嗚…求求你…', '我再也不敢了!', '饒了我吧!', '你要什麼我都給你!', '我真的知道錯了!'],
  ['我跪下來求你了…', '媽媽…救我…', '嗚哇啊啊啊!', '不要再打了嗚嗚嗚…', '我是垃圾…我是廢物…'],
  ['…救…命…', '嗚…嗚…', '我…不行了…', '放…過…我…', '腦袋…一片空白…'],
];
const OUCH = ['噗啊!', '嗚!', '啊啊!', '好痛!', '咿!', '嘎!', '哇!', '唔噗!'];
const GRAB_LINES = ['等等等等!', '放我下來!', '不要摔我!!', '哇啊啊啊!'];
const KO_SOB = ['嗚嗚嗚嗚…', '我要回家…', '媽…', '我錯了…全部都是我的錯…', '…(崩潰中)'];
const STAGE_NAME = ['囂張', '慌張', '求饒', '崩潰邊緣', '瀕臨崩潰'];
const END_SUB = ['他現在只想回家找媽媽。', '他的自尊心已經碎成渣了。', '從今以後他會乖乖的。', '他決定重新做人。', '他已經哭到說不出話了。'];

/* ------------------------------------------------------------------ face */
const FS = 256;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const face = { canvas: mk(FS, FS), gray: mk(FS, FS), skin: '#e8b88f', name: '那個混蛋' };
const defaultFace = mk(FS, FS);
(function drawDefault() {
  const x = defaultFace.getContext('2d'), c = FS / 2, R = FS / 2;
  x.fillStyle = '#f0c49b'; x.beginPath(); x.ellipse(c, c + 8, R * 0.82, R * 0.92, 0, 0, TAU); x.fill();
  x.fillStyle = '#3a2a1e'; x.beginPath(); x.ellipse(c, c - R * 0.62, R * 0.86, R * 0.45, 0, Math.PI, TAU); x.fill();
  x.fillRect(c - R * 0.86, c - R * 0.66, R * 0.2, R * 0.4); x.fillRect(c + R * 0.66, c - R * 0.66, R * 0.2, R * 0.4);
  // smug brows
  x.strokeStyle = '#3a2a1e'; x.lineWidth = 9; x.lineCap = 'round';
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(c + s * R * 0.14, c - R * 0.24); x.lineTo(c + s * R * 0.5, c - R * 0.32); x.stroke(); }
  // half-closed eyes
  for (const s of [-1, 1]) {
    x.fillStyle = '#fff'; x.beginPath(); x.ellipse(c + s * R * 0.32, c - R * 0.1, R * 0.13, R * 0.07, 0, 0, TAU); x.fill();
    x.fillStyle = '#222'; x.beginPath(); x.arc(c + s * R * 0.3, c - R * 0.08, R * 0.05, 0, TAU); x.fill();
    x.strokeStyle = '#3a2a1e'; x.lineWidth = 5; x.beginPath(); x.moveTo(c + s * R * 0.18, c - R * 0.13); x.lineTo(c + s * R * 0.46, c - R * 0.13); x.stroke();
  }
  x.strokeStyle = '#c48e66'; x.lineWidth = 5; x.beginPath(); x.moveTo(c, c - R * 0.02); x.lineTo(c - R * 0.06, c + R * 0.2); x.lineTo(c + R * 0.04, c + R * 0.22); x.stroke();
  // smirk
  x.strokeStyle = '#7a3b2e'; x.lineWidth = 7; x.beginPath(); x.moveTo(c - R * 0.22, c + R * 0.45); x.quadraticCurveTo(c + R * 0.05, c + R * 0.5, c + R * 0.26, c + R * 0.36); x.stroke();
})();

/* face editor */
const ed = { img: null, zoom: 1, rot: 0, ox: 0, oy: 0 };
const edC = $('#editor'), edX = edC.getContext('2d');
const ES = edC.width, ER = ES * 0.42;
const ZMIN = 0.3, ZMAX = 12;
function drawSource(x, cx, cy, k) {
  if (!ed.img) { x.drawImage(defaultFace, cx - ER * k, cy - ER * k, 2 * ER * k, 2 * ER * k); return; }
  const img = ed.img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = (2 * ER / Math.min(iw, ih)) * ed.zoom * k;
  x.save(); x.translate(cx + ed.ox * k, cy + ed.oy * k); x.rotate(ed.rot);
  x.drawImage(img, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
  x.restore();
}
function drawEditor() {
  const x = edX, c = ES / 2;
  x.fillStyle = '#1b1b25'; x.fillRect(0, 0, ES, ES);
  drawSource(x, c, c, 1);
  x.fillStyle = 'rgba(10,8,20,0.66)';
  x.beginPath(); x.rect(0, 0, ES, ES); x.rect(c - ER, c - ER, 2 * ER, 2 * ER); x.fill('evenodd');
  x.save();
  x.strokeStyle = 'rgba(255,215,0,0.95)'; x.lineWidth = 3; x.setLineDash([12, 9]);
  x.beginPath(); x.ellipse(c, c, ER * 0.8, ER * 0.98, 0, 0, TAU); x.stroke();
  for (const s of [-1, 1]) { x.beginPath(); x.ellipse(c + s * 0.32 * ER, c - 0.1 * ER, 0.14 * ER, 0.085 * ER, 0, 0, TAU); x.stroke(); }
  x.beginPath(); x.ellipse(c, c + 0.45 * ER, 0.24 * ER, 0.09 * ER, 0, 0, TAU); x.stroke();
  x.setLineDash([]);
  x.fillStyle = 'rgba(255,215,0,0.95)'; x.font = `900 22px ${FONT}`; x.textAlign = 'center';
  x.fillText('眼', c - 0.32 * ER, c - 0.24 * ER); x.fillText('眼', c + 0.32 * ER, c - 0.24 * ER); x.fillText('嘴', c, c + 0.66 * ER);
  x.restore();
}
/* Cut the head out of the photo: flood-fill the background in from the edges
   (colour-similar, connected to the border), never touching the central face
   area; fall back to a soft head-shaped oval if that fails. */
function cutoutHead(d) {
  const N = FS * FS, bg = new Uint8Array(N), seed = new Int32Array(N).fill(-1), q = new Int32Array(N);
  let qh = 0, qt = 0;
  const core = (i) => { const px = (i % FS) / FS - 0.5, py = ((i / FS) | 0) / FS - 0.5; return (px / 0.17) ** 2 + (py / 0.24) ** 2 < 1; };
  const push = (i, s) => { bg[i] = 1; seed[i] = s; q[qt++] = i; };
  for (let k = 0; k < FS; k++) for (const i of [k, (FS - 1) * FS + k, k * FS, k * FS + FS - 1]) if (!bg[i]) push(i, i);
  const dist = (a, b) => Math.abs(d[a * 4] - d[b * 4]) + Math.abs(d[a * 4 + 1] - d[b * 4 + 1]) + Math.abs(d[a * 4 + 2] - d[b * 4 + 2]);
  while (qh < qt) {
    const i = q[qh++], px = i % FS;
    const nb = [px > 0 ? i - 1 : -1, px < FS - 1 ? i + 1 : -1, i - FS, i + FS];
    for (const j of nb) {
      if (j < 0 || j >= N || bg[j] || core(j)) continue;
      if (d[j * 4 + 3] < 20 || d[i * 4 + 3] < 20) push(j, j); // outside the photo, or the photo's own edge
      else if (dist(i, j) < 30 && dist(seed[i], j) < 90) push(j, seed[i]);
    }
  }
  let removed = 0;
  for (let i = 0; i < N; i++) removed += bg[i];
  const frac = removed / N, a = new Float32Array(N);
  if (frac < 0.06 || frac > 0.85) {
    // fallback: feathered oval in the shape of a head
    for (let i = 0; i < N; i++) {
      const px = (i % FS) / FS - 0.5, py = ((i / FS) | 0) / FS - 0.5, r = Math.hypot(px / 0.4, py / 0.49);
      a[i] = clamp((1 - r) / 0.06, 0, 1);
    }
  } else {
    // shrink the mask by a pixel (drops background-coloured fringe), then feather it
    const box = (src, f) => {
      const out = new Float32Array(N);
      for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= FS || yy >= FS) continue;
          s += src[yy * FS + xx]; n++;
        }
        out[y * FS + x] = f(s / n);
      }
      return out;
    };
    const fg = new Float32Array(N);
    for (let i = 0; i < N; i++) fg[i] = bg[i] ? 0 : 1;
    a.set(box(box(fg, v => (v > 0.99 ? 1 : 0)), v => v));
  }
  for (let i = 0; i < N; i++) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * a[i]);
}
function finalizeFace() {
  const x = face.canvas.getContext('2d');
  x.clearRect(0, 0, FS, FS);
  drawSource(x, FS / 2, FS / 2, FS / (2 * ER));
  const g = face.gray.getContext('2d');
  g.clearRect(0, 0, FS, FS);
  try {
    const id = x.getImageData(0, 0, FS, FS), d = id.data;
    if (ed.img) { cutoutHead(d); x.putImageData(id, 0, 0); }
    let r = 0, gg = 0, b = 0, n = 0;
    for (let py = Math.floor(FS * 0.55); py < FS * 0.68; py++) {
      for (let px = Math.floor(FS * 0.22); px < FS * 0.78; px++) {
        if (Math.abs(px - FS / 2) < FS * 0.08) continue;
        const i = (py * FS + px) * 4; if (d[i + 3] < 128) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    if (n) face.skin = `rgb(${(r / n) | 0},${(gg / n) | 0},${(b / n) | 0})`;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      d[i] = l * 0.95; d[i + 1] = l * 0.97; d[i + 2] = Math.min(255, l * 1.05);
    }
    g.putImageData(id, 0, 0);
  } catch (e) {
    g.clearRect(0, 0, FS, FS); g.drawImage(face.canvas, 0, 0);
  }
}

/* ------------------------------------------------------------------ poses
   pose = [lean, head, backArm1, backArm2, frontArm1, frontArm2, backLeg1, backLeg2, frontLeg1, frontLeg2]
   angles in radians, 0 = pointing down, positive = rotating toward facing direction */
const STANCE      = [0.12, -0.1, 0.6, 1.9, 1.0, 1.6, -0.35, -0.15, 0.35, -0.35];
const PUNCH_WIND  = [0.02, -0.05, 0.9, 1.5, 0.3, 2.2, -0.4, -0.1, 0.4, -0.4];
const PUNCH_HIT   = [0.32, -0.25, 0.3, 2.0, 1.57, 0.0, -0.55, 0.0, 0.45, -0.3];
const PUNCHB_WIND = [0.05, -0.05, 0.2, 2.2, 1.1, 1.4, -0.4, -0.1, 0.4, -0.4];
const PUNCHB_HIT  = [0.35, -0.25, 1.57, 0.0, 0.4, 2.0, -0.6, 0.0, 0.45, -0.3];
const SLAP_WIND   = [-0.08, 0.05, 0.6, 1.8, -0.6, 2.0, -0.35, -0.15, 0.35, -0.35];
const SLAP_HIT    = [0.28, -0.15, 0.5, 1.8, 1.45, 0.15, -0.5, -0.05, 0.4, -0.35];
const SLAPB_WIND  = [-0.05, 0.05, -0.5, 2.0, 0.8, 1.7, -0.35, -0.15, 0.35, -0.35];
const SLAPB_HIT   = [0.28, -0.15, 1.5, 0.1, 0.6, 1.8, -0.5, -0.05, 0.4, -0.35];
const KICK_WIND   = [-0.1, 0.0, 0.8, 1.5, 1.0, 1.6, -0.1, 0.0, 1.0, -1.7];
const KICK_HIT    = [-0.38, 0.18, 1.3, 0.7, 0.5, 1.5, -0.15, 0.0, 1.78, 0.0];
const UPPER_WIND  = [0.4, -0.2, 0.6, 1.7, 0.2, 2.1, -0.25, -0.75, 0.95, -1.05];
const UPPER_HIT   = [-0.15, -0.35, 0.6, 1.8, 2.95, 0.12, -0.3, -0.1, 0.5, -0.9];
const SMASH_WIND  = [-0.25, -0.2, 3.0, 0.3, 3.1, 0.2, 0.4, -1.4, 1.1, -1.6];
const SMASH_HIT   = [0.55, 0.25, 1.7, 0.3, 1.5, 0.3, 0.3, -1.2, 1.0, -1.5];
const GRAB        = [0.25, 0.0, 1.3, 0.3, 1.45, 0.2, -0.45, -0.1, 0.45, -0.4];
const LIFT        = [-0.3, -0.3, 3.0, 0.1, 3.1, 0.05, -0.3, -0.2, 0.4, -0.4];
const SLAM        = [-0.45, -0.2, 4.1, 0.2, 4.2, 0.1, -0.2, -0.3, 0.6, -0.6];
const PILE_LAND   = [0.3, 0.2, 2.2, 0.4, 2.3, 0.3, -0.9, -0.9, 1.2, -2.0];
const JUMP        = [0.15, -0.15, 2.3, 0.9, 2.0, 1.0, 0.5, -1.7, 1.3, -1.9];
const FALL        = [0.05, -0.05, 1.9, 0.7, 1.7, 0.8, 0.1, -0.6, 0.7, -0.9];
const CROUCH      = [0.45, -0.3, 0.7, 1.9, 1.1, 1.7, 0.9, -2.0, 1.35, -2.25];
const VICTORY     = [0.0, -0.25, 0.4, 0.5, 3.0, 0.2, -0.2, 0.0, 0.2, 0.0];
// opponent
const COWER  = [-0.15, 0.15, 0.5, 2.3, 0.7, 2.2, -0.1, -0.15, 0.2, -0.35];
const KNEEL  = [0.1, 0.2, 0.9, 1.6, 1.0, 1.5, 0.0, -1.57, 0.15, -1.7];
const HURT   = [-0.45, -0.5, -0.4, 0.6, 2.4, 0.6, -0.3, 0.0, 0.3, -0.2];
const HURT2  = [-0.3, -0.35, 2.6, 0.5, -0.6, 0.4, -0.4, -0.1, 0.25, -0.3];
const AIR    = [-0.3, -0.4, 2.8, 0.3, 2.2, 0.6, 0.6, -0.8, 0.9, -0.3];
const AIR2   = [-0.2, -0.3, 1.9, 0.8, 3.0, 0.4, 0.2, -0.3, 1.2, -1.0];
const LYING  = [0.0, 0.1, 2.6, 0.4, 0.4, 0.6, 0.1, -0.1, -0.2, 0.2];

function lerpPose(a, b, t) { const r = new Array(10); for (let i = 0; i < 10; i++) r[i] = a[i] + (b[i] - a[i]) * t; return r; }
function kf(frames, t) {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i][0]) {
      const [t0, p0] = frames[i - 1], [t1, p1] = frames[i];
      return lerpPose(p0, p1, ease((t - t0) / (t1 - t0)));
    }
  }
  return frames[frames.length - 1][1];
}
const STRIKE = {
  slap: [SLAP_WIND, SLAP_HIT], slapB: [SLAPB_WIND, SLAPB_HIT],
  punch: [PUNCH_WIND, PUNCH_HIT], punchB: [PUNCHB_WIND, PUNCHB_HIT],
  kick: [KICK_WIND, KICK_HIT], upper: [UPPER_WIND, UPPER_HIT], smash: [SMASH_WIND, SMASH_HIT],
};
function strikePose(m, t) {
  let prevT = 0, prev = STANCE, prevKind = null;
  for (const h of m.hits) {
    const [wind, hit] = STRIKE[h.kind];
    if (t <= h.t) {
      P.open = h.kind === 'slap' ? 'F' : h.kind === 'slapB' ? 'B' : null;
      const u = (t - prevT) / (h.t - prevT);
      if (u < 0.6) return lerpPose(prev, wind, ease(u / 0.6));
      return lerpPose(wind, hit, easeOut((u - 0.6) / 0.4));
    }
    prevT = h.t; prev = hit; prevKind = h.kind;
  }
  P.open = prevKind === 'slap' ? 'F' : prevKind === 'slapB' ? 'B' : null;
  const u = (t - prevT) / Math.max(0.01, m.dur - prevT);
  if (u < 0.35) return prev;
  return lerpPose(prev, STANCE, ease((u - 0.35) / 0.65));
}

/* ------------------------------------------------------------------ moves */
const HIT = (t, kind, dmg, kx, o = {}) => Object.assign({ t, kind, dmg, kx, ky: 0, stun: 0.4 }, o);
const MOVES = {
  slap:  { dur: 0.32, reach: 72, hits: [HIT(0.13, 'slap', 4, 140)] },
  punch: { dur: 0.32, reach: 84, hits: [HIT(0.11, 'punch', 6, 240)] },
  kick:  { dur: 0.46, reach: 110, hits: [HIT(0.19, 'kick', 8, 430, { stun: 0.55 })] },
  throw: { dur: 1.0, reach: 64, grab: 'throw', frames: [[0, STANCE], [0.15, GRAB], [0.45, LIFT], [0.75, SLAM], [1.0, STANCE]] },
  slapRush: { title: '連環巴掌', dur: 1.0, reach: 72, hits: [] },
  punchRush: { title: '百裂拳', dur: 1.05, reach: 84, hits: [] },
  rising: { title: '沖天拳', dur: 0.8, reach: 84, hits: [HIT(0.2, 'upper', 11, 90, { ky: 880, stun: 0.6 })] },
  pile: { title: '地獄摔', dur: 1.45, reach: 66, grab: 'pile', frames: [[0, STANCE], [0.15, GRAB], [0.45, LIFT], [0.7, LIFT], [0.92, PILE_LAND], [1.45, STANCE]] },
  chain: { title: '連環技', dur: 1.15, reach: 80, hits: [
    HIT(0.1, 'slap', 3, 40), HIT(0.25, 'slapB', 3, 40), HIT(0.42, 'punch', 4, 50), HIT(0.56, 'punchB', 4, 60), HIT(0.8, 'kick', 7, 470, { stun: 0.6 })] },
  ultimate: { title: '終極連環技!!', dur: 2.6, reach: 60, ultimate: true, hits: [] },
};
for (let i = 0; i < 6; i++) MOVES.slapRush.hits.push(HIT(0.1 + i * 0.12, i % 2 ? 'slapB' : 'slap', 3, i === 5 ? 340 : 50, { light: i < 5 }));
for (let i = 0; i < 8; i++) MOVES.punchRush.hits.push(HIT(0.08 + i * 0.1, i % 2 ? 'punchB' : 'punch', 2.5, i === 7 ? 360 : 35, { light: i < 7, ky: i === 7 ? 260 : 0 }));
[0.32, 0.42, 0.52, 0.62].forEach((t, i) => MOVES.ultimate.hits.push(HIT(t, i % 2 ? 'slapB' : 'slap', 2.5, 25, { force: true, light: true })));
[0.76, 0.85, 0.94, 1.03].forEach((t, i) => MOVES.ultimate.hits.push(HIT(t, i % 2 ? 'punchB' : 'punch', 2.5, 25, { force: true, light: true })));
MOVES.ultimate.hits.push(HIT(1.18, 'kick', 5, 40, { force: true }));
MOVES.ultimate.hits.push(HIT(1.4, 'upper', 6, 40, { ky: 900, force: true }));
MOVES.ultimate.hits.push(HIT(1.92, 'smash', 10, 120, { ky: -1400, force: true }));

const SEQS = [
  { seq: 'slap,slap,slap', move: 'slapRush' },
  { seq: 'punch,punch,punch', move: 'punchRush' },
  { seq: 'slap,punch,kick', move: 'rising' },
  { seq: 'kick,kick,throw', move: 'pile' },
];

/* ------------------------------------------------------------------ entities */
const PD = { torso: 68, ua: 30, fa: 28, th: 42, sh: 42, headR: 21, neck: 5 };
const OD = { torso: 62, ua: 27, fa: 25, th: 38, sh: 38, headR: 46, neck: 4 };
const G = { running: false };
const P = {};
const O = {};

function resetGame() {
  Object.assign(G, {
    t: 0, hitstop: 0, slow: 1, slowT: 0, shake: 0, combo: 0, comboT: 0, comboPop: 0, maxCombo: 0, hits: 0, meter: 0,
    particles: [], texts: [], bubble: null, bubbleCD: 1.5, ko: false, koT: 0, endShown: false, flash: 0, dim: 0,
    banner: null, hist: [], stringCut: -1, bar: { x: 660, v: 0 }, startTime: performance.now(), sobCD: 2,
  });
  Object.assign(P, { x: 300, h: 0, vy: 0, air: false, crouch: false, f: 1, act: null, queue: null, pose: STANCE.slice(), walkPh: 0, bodyRot: 0, hold: null, open: null, J: null });
  Object.assign(O, {
    x: 660, h: 0, vx: 0, vy: 0, f: -1, state: 'idle', st: 0, maxHp: 150, hp: 150, ghostHp: 150, stage: 0,
    headRot: 0, headRotV: 0, squash: 0, hitFlash: 0, marks: [], lumps: [], cracks: null, pose: COWER.slice(),
    bodyRot: 0, hold: null, bounced: false, hurtVar: false, J: null,
  });
  P.J = solveBody(P, PD); O.J = solveBody(O, OD);
}
const dmgRatio = () => 1 - O.hp / O.maxHp;
function stageOf() { const r = O.hp / O.maxHp; return r > 0.8 ? 0 : r > 0.6 ? 1 : r > 0.4 ? 2 : r > 0.2 ? 3 : 4; }

/* forward kinematics: local joints around the hip, rotated by bodyRot, then mirrored by facing */
function solveBody(E, D) {
  const p = E.pose, f = E.f, rot = E.bodyRot || 0;
  const lean = p[0];
  const L = {};
  L.hip = [0, 0];
  L.neck = [Math.sin(lean) * D.torso, -Math.cos(lean) * D.torso];
  L.sh = [L.neck[0] * 0.9, L.neck[1] * 0.9];
  const limb = (o, a1, a2, l1, l2) => {
    const m = [o[0] + Math.sin(a1) * l1, o[1] + Math.cos(a1) * l1];
    return [m, [m[0] + Math.sin(a1 + a2) * l2, m[1] + Math.cos(a1 + a2) * l2]];
  };
  [L.eB, L.hB] = limb(L.sh, p[2], p[3], D.ua, D.fa);
  [L.eF, L.hF] = limb(L.sh, p[4], p[5], D.ua, D.fa);
  [L.kB, L.fB] = limb(L.hip, p[6], p[7], D.th, D.sh);
  [L.kF, L.fF] = limb(L.hip, p[8], p[9], D.th, D.sh);
  const ha = lean + p[1], hd = D.headR + D.neck;
  L.head = [L.neck[0] + Math.sin(ha) * hd, L.neck[1] - Math.cos(ha) * hd];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const k in L) { const [x, y] = L[k]; L[k] = [x * c - y * s, x * s + y * c]; }
  let hx, hy;
  if (E.hold) { hx = E.hold.x; hy = E.hold.y; }
  else {
    let maxY = -1e9;
    for (const k of ['fB', 'fF']) maxY = Math.max(maxY, L[k][1] + 5);
    for (const k of ['kB', 'kF', 'hip', 'neck']) maxY = Math.max(maxY, L[k][1] + 11);
    maxY = Math.max(maxY, L.head[1] + D.headR * 0.55);
    hx = E.x; hy = GY - E.h - maxY;
  }
  const J = {};
  for (const k in L) J[k] = [hx + L[k][0] * f, hy + L[k][1]];
  J.headAngle = f * (ha + rot);
  J.footVec = [Math.cos(rot) * f, Math.sin(rot)];
  J.rot = rot;
  return J;
}

/* ------------------------------------------------------------------ input */
const held = { left: false, right: false, up: false, down: false };
const JUMP_V = 1050;
function jump() {
  if (!G.running || G.ko || P.air || P.act) return;
  audio();
  P.air = true; P.vy = JUMP_V; P.h = Math.max(P.h, 1); P.crouch = false;
  SFX.whoosh();
}
const groundOnly = name => name === 'throw' || name === 'pile' || name === 'chain' || name === 'ultimate';
function press(btn) {
  if (!G.running || G.ko) return;
  audio();
  if (P.act || (P.air && btn === 'throw')) {
    if (!P.act) { P.queue = btn; return; }
    if (!P.act.m.ultimate && P.act.t > P.act.m.dur * 0.45) P.queue = btn;
    return;
  }
  doPress(btn);
}
function doPress(btn) {
  let name = btn;
  if (btn === 'chain') {
    if (G.meter >= 100) { name = 'ultimate'; G.meter = 0; } else name = 'chain';
    G.hist = [];
  } else {
    const last = G.hist[G.hist.length - 1];
    if (last && G.t - last.t > 0.9) G.hist = [];
    G.hist.push({ b: btn, t: G.t });
    if (G.hist.length > 3) G.hist.shift();
    if (G.hist.length === 3) {
      const s = G.hist.map(h => h.b).join(',');
      const hit = SEQS.find(q => q.seq === s);
      if (hit) { name = hit.move; G.hist = []; }
    }
  }
  if (P.air && groundOnly(name)) { // grabs and the chain need solid ground: fire on landing
    if (name === 'ultimate') G.meter = 100;
    P.queue = btn; return;
  }
  startMove(name);
}
function startMove(name) {
  const m = MOVES[name];
  P.crouch = false;
  P.f = Math.sign(O.x - P.x) || P.f;
  P.act = { name, m, t: 0, hi: 0, checked: false, grabbed: false, done: false };
  if (m.title) G.banner = { text: m.title, t: 0, ult: !!m.ultimate };
  if (m.ultimate) { G.hitstop = 0.35; G.flash = 0.7; SFX.superStart(); }
  else SFX.whoosh();
}

/* ------------------------------------------------------------------ fx helpers */
function addText(x, y, text, color = '#ffe14d', size = 44) {
  G.texts.push({ x, y, text, color, size, t: 0, life: 0.75, rot: rand(-0.25, 0.25) });
}
function setBubble(text, big) {
  const b = G.bubble;
  if (!big && b && b.big && b.t < 1.1) return;
  G.bubble = { text, t: 0, dur: big ? 2.3 : 0.9, big, size: big ? 24 : 22 };
}
function burst(x, y, dir, kind) {
  const big = kind === 'smash' || kind === 'slam' || kind === 'upper';
  const isSlap = kind.startsWith('slap');
  const n = big ? 22 : 13;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(250, big ? 900 : 650);
    G.particles.push({ type: 'spark', x, y, vx: Math.cos(a) * sp + dir * 150, vy: Math.sin(a) * sp, life: rand(0.12, 0.3), t: 0, color: isSlap ? '#ffffff' : pick(['#ffe14d', '#ffffff', '#ff9d2e']) });
  }
  G.particles.push({ type: 'ring', x, y, life: 0.25, t: 0, r1: big ? 110 : isSlap ? 60 : 80, color: isSlap ? '#ff6b9a' : '#ffe14d' });
  for (let i = 0; i < 3; i++) G.particles.push({ type: 'drop', x, y, vx: dir * rand(100, 300), vy: rand(-350, -150), g: 1400, life: 1, t: 0, size: rand(3, 5), color: '#a9dcff' });
}
function landFx(k) {
  const x = O.hold ? O.hold.x : O.x;
  for (let i = 0; i < 12 * k; i++) G.particles.push({ type: 'dust', x: x + rand(-50, 50), y: GY + rand(-6, 4), vx: rand(-160, 160), vy: rand(-90, -10), life: rand(0.4, 0.8), t: 0, size: rand(8, 18) });
  G.shake = Math.max(G.shake, 10 * k);
  SFX.thud();
}

/* ------------------------------------------------------------------ combat */
function canHit(h, m) {
  if (O.state === 'grabbed' || O.state === 'ko') return false;
  if (h.force) return true;
  if (O.state === 'down' || O.state === 'getup') return false;
  const dx = (O.x - P.x) * P.f;
  if (dx < -20 || dx > m.reach + 30) return false;
  if (O.h > (h.kind === 'upper' || h.kind === 'kick' ? 200 : 150)) return false;
  return true;
}
function hitOpp(h) {
  const dir = P.f;
  O.vx = dir * h.kx;
  if (h.ky) { O.vy = h.ky; O.h = Math.max(O.h, 1); O.state = 'air'; O.bounced = false; }
  else if (O.h > 0) { O.vy = Math.max(O.vy, 260); O.state = 'air'; }
  else { O.state = 'hit'; O.st = h.stun; O.hurtVar = !O.hurtVar; O.pose = (O.hurtVar ? HURT : HURT2).slice(); }
  applyHit(h.dmg, h.kind, dir, h);
}
const HIT_TEXT = { slap: '啪!', slapB: '啪!', punch: '碰!', punchB: '碰!', kick: '砰!', upper: '咚!!', smash: '轟!!', slam: '轟隆!!', wall: '撞牆!' };
function applyHit(dmg, kind, dir, h = {}) {
  const prevStage = O.stage;
  O.hp = Math.max(0, O.hp - dmg);
  O.stage = stageOf();
  O.hitFlash = 1;
  const isSlap = kind.startsWith('slap'), isPunch = kind.startsWith('punch');
  O.headRotV += dir * (isSlap ? rand(15, 21) : isPunch ? rand(8, 12) : kind === 'wall' ? 6 : 11);
  O.squash = isSlap ? 0.5 : 0.35;
  addMark(kind, dir);

  const J = O.J, R = OD.headR;
  const mid = [(J.hip[0] + J.neck[0]) / 2, (J.hip[1] + J.neck[1]) / 2];
  const pos = (kind === 'kick' || kind === 'slam' || kind === 'wall') ? mid : [J.head[0] - dir * R * 0.6, J.head[1] + (isSlap ? 10 : 0)];
  burst(pos[0], pos[1], dir, kind);
  addText(pos[0] + rand(-20, 20), pos[1] - 30, HIT_TEXT[kind] || '碰!', isSlap ? '#ff5d8f' : kind === 'slam' || kind === 'smash' ? '#ff3b3b' : '#ffe14d', kind === 'slam' || kind === 'smash' ? 64 : isSlap ? 52 : 46);

  const d = dmgRatio();
  if (d > 0.3) {
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      G.particles.push({ type: 'drop', x: J.head[0] + s * R * 0.32, y: J.head[1], vx: dir * rand(80, 260) + s * 40, vy: rand(-320, -120), g: 1400, life: 1.2, t: 0, size: rand(3, 6), color: '#7cc8ff' });
    }
  }
  if ((isPunch || kind === 'upper' || kind === 'smash' || kind === 'slam') && O.stage >= 2 && Math.random() < 0.3) {
    G.particles.push({ type: 'tooth', x: J.head[0], y: J.head[1] + R * 0.4, vx: dir * rand(150, 380), vy: rand(-520, -300), g: 1500, life: 2.2, t: 0, rot: 0, vr: rand(-20, 20) });
  }

  if (isSlap) SFX.slap(); else if (isPunch) SFX.punch(); else if (kind === 'slam' || kind === 'smash') SFX.slam(); else if (kind === 'wall') SFX.thud(); else SFX.kick();
  const stop = { slap: 0.075, slapB: 0.075, punch: 0.06, punchB: 0.06, kick: 0.09, upper: 0.12, smash: 0.15, slam: 0.12, wall: 0.05 }[kind] || 0.06;
  G.hitstop = Math.max(G.hitstop, h.light ? 0.03 : stop);
  G.shake = Math.max(G.shake, { kick: 10, upper: 13, smash: 22, slam: 20 }[kind] || (isSlap ? 6 : 7));

  G.combo = G.comboT > 0 ? G.combo + 1 : 1;
  G.comboT = 1.15; G.comboPop = 1;
  G.maxCombo = Math.max(G.maxCombo, G.combo);
  G.hits++;
  if (!(P.act && P.act.m.ultimate)) G.meter = Math.min(100, G.meter + 7);

  if (O.hp <= 0 && !G.ko) { triggerKO(dir); return; }
  if (G.ko) return;
  if (O.stage !== prevStage) {
    const line = pick(BEG[O.stage]);
    setBubble(line, true); speak(line, O.stage / 4, true);
    G.bubbleCD = 3;
  } else if (Math.random() < 0.5) setBubble(pick(OUCH), false);
  else if (Math.random() < 0.3) { const line = pick(BEG[O.stage]); setBubble(line, true); speak(line, O.stage / 4); }
}
function addMark(kind, dir) {
  const side = -dir; // the cheek that faces the attacker (head is never mirrored)
  const M = O.marks;
  if (kind.startsWith('slap')) M.push({ type: 'hand', u: side * rand(0.36, 0.55), v: rand(0.1, 0.35), rot: side * rand(0.2, 0.6) + rand(-0.2, 0.2), s: rand(0.85, 1.1), born: G.t });
  else if (kind.startsWith('punch') || kind === 'upper') {
    if (Math.random() < 0.35) M.push({ type: 'black', u: pick([-0.32, 0.32]), v: -0.1, s: rand(0.9, 1.1) });
    else M.push({ type: 'bruise', u: rand(-0.5, 0.5), v: rand(-0.45, 0.4), s: rand(0.8, 1.3) });
  } else if (kind !== 'wall') {
    M.push({ type: 'bruise', u: rand(-0.5, 0.5), v: rand(-0.5, 0.4), s: rand(1.1, 1.6) });
    if (O.lumps.length < 4 && Math.random() < 0.6) O.lumps.push({ a: -Math.PI / 2 + rand(-0.9, 0.9), s: rand(0.8, 1.2) });
  }
  if (M.length > 30) M.shift();
}
function triggerKO(dir) {
  G.ko = true; G.koT = 0; G.slow = 0.3; G.slowT = 1.4; G.flash = 0.9; G.stringCut = 0;
  P.queue = null;
  SFX.ko(); SFX.glass();
  const line = '我…我崩潰了…嗚哇啊啊啊!';
  setBubble(line, true); speak(line, 1, true);
  O.cracks = [];
  for (let i = 0; i < 6; i++) {
    let u = rand(-0.2, 0.2), v = rand(-0.3, 0.1);
    const a = rand(0, TAU), pts = [[u, v]];
    for (let k = 0; k < 6; k++) { u += Math.cos(a + rand(-0.6, 0.6)) * 0.17; v += Math.sin(a + rand(-0.6, 0.6)) * 0.17; pts.push([u, v]); }
    O.cracks.push(pts);
  }
  if (O.state !== 'grabbed') {
    O.vy = Math.max(O.vy, 620); O.h = Math.max(O.h, 1); O.state = 'air'; O.bounced = false;
    O.vx = dir * Math.max(Math.abs(O.vx), 280);
  }
}

/* ------------------------------------------------------------------ update */
function airPhysics(dt, steer) {
  if (!P.air) return false;
  P.vy -= GRAV * 1.6 * dt; P.h += P.vy * dt;
  if (steer) P.x += steer * 300 * dt;
  if (P.h <= 0) {
    P.h = 0; P.vy = 0; P.air = false;
    for (let i = 0; i < 6; i++) G.particles.push({ type: 'dust', x: P.x + rand(-30, 30), y: GY + rand(-4, 4), vx: rand(-120, 120), vy: rand(-60, -10), life: rand(0.3, 0.5), t: 0, size: rand(6, 12) });
    return true;
  }
  return false;
}
function updatePlayer(dt) {
  const A = P.act;
  const mv = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  if (A) {
    const m = A.m;
    A.t += dt;
    const f = P.f;
    if (m.ultimate) {
      const tx = O.x - f * 58;
      P.x += clamp(tx - P.x, -1600 * dt, 1600 * dt);
      const t = A.t;
      P.h = t < 1.45 ? 0 : t < 1.85 ? 270 * easeOut((t - 1.45) / 0.4) : t < 2.25 ? 270 * (1 - Math.pow((t - 1.85) / 0.4, 2)) : 0;
    } else if (m.hits && P.air) {
      airPhysics(dt, G.ko ? 0 : mv * 0.6);
    } else if (m.hits) {
      if (A.t < m.hits[0].t + 0.02) {
        const tx = O.x - f * (m.reach - 12), d = tx - P.x;
        if (d * f > 0) P.x += Math.sign(d) * Math.min(Math.abs(d), 900 * dt);
      }
    } else if (m.grab && !A.checked) {
      const tx = O.x - f * (m.reach - 10), d = tx - P.x;
      if (d * f > 0) P.x += Math.sign(d) * Math.min(Math.abs(d), 900 * dt);
    }
    if (m.hits) {
      while (A.hi < m.hits.length && A.t >= m.hits[A.hi].t) {
        const h = m.hits[A.hi++];
        if (canHit(h, m)) hitOpp(h);
      }
      P.pose = strikePose(m, A.t);
    } else {
      P.open = null;
      P.pose = kf(m.frames, A.t);
      updateGrab(A, m);
    }
    if (A.t >= m.dur) {
      P.act = null; if (!P.air) P.h = 0;
      if (O.state === 'grabbed') { O.state = 'idle'; O.hold = null; O.bodyRot = 0; }
      if (P.queue && !G.ko) { const q = P.queue; P.queue = null; doPress(q); }
      P.queue = null;
    }
  } else {
    P.open = null;
    if (P.air) {
      const landed = airPhysics(dt, G.ko ? 0 : mv);
      P.pose = lerpPose(P.pose, P.vy > 0 ? JUMP : FALL, 1 - Math.exp(-dt * 14));
      if (landed && P.queue && !G.ko) { const q = P.queue; P.queue = null; doPress(q); }
    } else {
    P.h = 0;
    if (held.up && !G.ko) jump();
    P.crouch = !G.ko && !P.air && held.down;
    if (P.air) { /* just jumped */ }
    else if (P.crouch) {
      const s = CROUCH.slice(); s[0] += Math.sin(G.t * 5) * 0.03;
      P.pose = lerpPose(P.pose, s, 1 - Math.exp(-dt * 20));
      if (mv) P.x += mv * 110 * dt;
    } else if (!G.ko && mv) {
      P.x += mv * 260 * dt;
      P.walkPh += dt * 11 * mv * P.f;
      const s = Math.sin(P.walkPh);
      P.pose = STANCE.slice();
      P.pose[6] = -0.3 - s * 0.45; P.pose[7] = -0.25 - Math.max(0, Math.cos(P.walkPh)) * 0.5;
      P.pose[8] = 0.3 + s * 0.45; P.pose[9] = -0.3 - Math.max(0, -Math.cos(P.walkPh)) * 0.5;
    } else if (G.ko) {
      const v = VICTORY.slice(); v[4] = 3.0 + Math.sin(G.t * 9) * 0.25; v[5] = 0.2 + Math.sin(G.t * 9) * 0.3;
      P.pose = lerpPose(P.pose, v, 1 - Math.exp(-dt * 10));
    } else {
      const b = Math.sin(G.t * 5);
      const s = STANCE.slice(); s[0] += b * 0.03; s[7] -= b * 0.05; s[9] -= b * 0.06;
      P.pose = lerpPose(P.pose, s, 1 - Math.exp(-dt * 18));
    }
    }
    if (O.state !== 'grabbed') P.f = Math.sign(O.x - P.x) || P.f;
  }
}
function updateGrab(A, m) {
  const t = A.t, f = P.f;
  if (!A.checked && t >= 0.15) {
    A.checked = true;
    const dx = (O.x - P.x) * f;
    if (dx > -10 && dx < m.reach + 40 && O.h < 40 && (O.state === 'idle' || O.state === 'hit')) {
      A.grabbed = true; O.state = 'grabbed'; O.vx = O.vy = 0; O.f = -f; O.h = 0;
      SFX.grab();
      const line = pick(GRAB_LINES); setBubble(line, true); speak(line, 0.8, true);
    }
  }
  if (!A.grabbed || A.done) { if (m.grab === 'pile') P.h = 0; return; }
  const jit = () => (Math.random() - 0.5) * 0.3;
  O.pose = lerpPose(O.pose, AIR, 0.25).map((v, i) => (i > 1 ? v + jit() : v));
  if (m.grab === 'throw') {
    const e = ease(clamp((t - 0.2) / 0.55, 0, 1)), phi = e * Math.PI;
    O.hold = { x: P.x + f * Math.cos(phi) * 60, y: GY - 100 - Math.sin(phi) * 105 };
    O.bodyRot = -e * Math.PI * 1.4;
    if (t >= 0.75) {
      A.done = true; O.hold = null;
      O.x = clamp(P.x - f * 80, 62, W - 62); O.h = 0; O.vx = -f * 80; O.vy = 0;
      O.f = f; O.bodyRot = -Math.PI / 2; O.state = 'down'; O.st = 1.0; O.pose = LYING.slice();
      landFx(1.4);
      applyHit(15, 'slam', -f);
    }
  } else {
    const l = ease(clamp((t - 0.2) / 0.3, 0, 1));
    P.h = t < 0.25 ? 0 : t < 0.6 ? 170 * easeOut((t - 0.25) / 0.35) : t < 0.9 ? 170 * (1 - Math.pow((t - 0.6) / 0.3, 2)) : 0;
    O.bodyRot = Math.PI * l;
    const hip = P.J.hip;
    O.hold = { x: P.x + f * lerp(45, 30, l), y: hip[1] - lerp(10, 150, l) };
    if (t >= 0.9) {
      A.done = true; O.hold = null; P.h = 0;
      O.x = clamp(P.x + f * 60, 62, W - 62); O.h = 1; O.vy = 420; O.vx = f * 220; O.bounced = true;
      O.state = 'air'; O.bodyRot = -2;
      landFx(1.8);
      applyHit(20, 'slam', f);
    }
  }
}
function updateOpp(dt) {
  O.headRotV += (-O.headRot * 260 - O.headRotV * 11) * dt;
  O.headRot = clamp(O.headRot + O.headRotV * dt, -1.2, 1.2);
  O.squash *= Math.exp(-dt * 9);
  O.hitFlash = Math.max(0, O.hitFlash - dt * 3);
  O.ghostHp = Math.max(O.hp, O.ghostHp - 30 * dt);
  if (O.state === 'grabbed') return;

  const toP = Math.sign(P.x - O.x) || 1;
  let target = COWER, rotT = 0, rate = 16;
  switch (O.state) {
    case 'air': {
      O.vy -= GRAV * dt; O.h += O.vy * dt; O.x += O.vx * dt;
      if (O.h <= 0) {
        O.h = 0;
        if (O.vy < -550 && !O.bounced) { O.vy = -O.vy * 0.38; O.h = 0.1; O.bounced = true; O.vx *= 0.6; landFx(0.8); }
        else {
          O.vy = 0; O.vx *= 0.3; landFx(0.6);
          if (O.hp <= 0) { O.state = 'ko'; O.st = 0; } else { O.state = 'down'; O.st = 0.9; }
        }
      }
      target = O.vy > 0 ? AIR : AIR2; rotT = O.vy > 0 ? -0.8 : -1.3; rate = 10;
      break;
    }
    case 'hit':
      O.st -= dt; O.f = toP;
      target = O.hurtVar ? HURT : HURT2; rate = 6;
      if (O.st <= 0) O.state = 'idle';
      break;
    case 'down':
      O.st -= dt; target = LYING; rotT = -Math.PI / 2;
      if (O.st <= 0) { O.state = 'getup'; O.st = 0.45; }
      break;
    case 'getup': {
      O.st -= dt;
      const k = clamp(1 - O.st / 0.45, 0, 1);
      target = lerpPose(LYING, O.stage >= 3 ? KNEEL : COWER, k); rotT = -Math.PI / 2 * (1 - k); rate = 30;
      if (O.st <= 0) { O.state = 'idle'; O.f = toP; }
      break;
    }
    case 'ko': {
      O.st += dt; rotT = -Math.PI / 2;
      target = LYING.slice();
      if (Math.sin(O.st * 7) > 0.85) { target[2] += rand(-0.6, 0.6); target[9] += rand(-0.5, 0.5); }
      break;
    }
    default: { // idle — trembling, fleeing, begging
      O.f = toP;
      const tr = 0.03 + O.stage * 0.015;
      if (O.stage >= 3) {
        target = KNEEL.slice();
        const bow = Math.max(0, Math.sin(G.t * 3.2));
        target[0] += bow * 0.55; target[1] += bow * 0.2;
        target[2] += Math.sin(G.t * 9) * 0.15; target[4] += Math.sin(G.t * 9 + 1) * 0.15;
      } else {
        target = COWER.slice();
        const dist = Math.abs(P.x - O.x);
        if (dist < 180 && !P.act) {
          const nx = O.x - toP * 75 * dt;
          if (nx > 70 && nx < W - 70) {
            O.x = nx;
            const s = Math.sin(G.t * 14);
            target[6] += s * 0.3; target[8] -= s * 0.3;
          }
        }
      }
      for (let i = 0; i < 10; i++) target[i] += rand(-tr, tr);
      rate = 22;
    }
  }
  if (O.state !== 'air') { O.x += O.vx * dt; O.vx *= Math.exp(-dt * 7); }
  // a body lying next to a wall slides back so its head stays on screen
  if (O.state === 'down' || O.state === 'ko' || O.state === 'getup') {
    const m = 175;
    if (O.x < m) O.x = lerp(O.x, m, 1 - Math.exp(-dt * 6));
    if (O.x > W - m) O.x = lerp(O.x, W - m, 1 - Math.exp(-dt * 6));
  }
  // walls
  for (const [lim, s] of [[62, -1], [W - 62, 1]]) {
    if ((s < 0 && O.x < lim) || (s > 0 && O.x > lim)) {
      O.x = lim;
      if (O.vx * s > 280 && !G.ko) {
        O.vx = -O.vx * 0.45;
        G.particles.push({ type: 'ring', x: lim + s * 20, y: O.J.neck[1], life: 0.3, t: 0, r1: 90, color: '#ffffff' });
        applyHit(2, 'wall', s);
      } else if (O.vx * s > 0) O.vx = 0;
    }
  }
  O.pose = lerpPose(O.pose, target, 1 - Math.exp(-dt * rate));
  O.bodyRot = lerp(O.bodyRot, rotT, 1 - Math.exp(-dt * 12));
}
function separate() {
  P.x = clamp(P.x, 40, W - 40);
  if (O.state === 'grabbed' || O.state === 'down' || O.state === 'ko' || O.state === 'getup' || O.h > 40 || P.h > 40) return;
  if (P.act && P.act.m.ultimate) return;
  const min = 54, dx = O.x - P.x;
  if (Math.abs(dx) < min) {
    const s = Math.sign(dx) || P.f, ov = min - Math.abs(dx);
    O.x = clamp(O.x + s * ov * 0.5, 62, W - 62);
    P.x = O.x - s * min;
    P.x = clamp(P.x, 40, W - 40);
  }
}
function updateFx(dt) {
  for (const p of G.particles) {
    p.t += dt;
    if (p.g) p.vy += p.g * dt;
    if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; }
    if (p.vr) p.rot += p.vr * dt;
    if ((p.type === 'drop' || p.type === 'tooth') && p.y > GY + 4) { p.y = GY + 4; p.vy *= -0.3; p.vx *= 0.5; if (p.vr) p.vr *= 0.5; }
    if (p.type === 'dust') { p.vx *= Math.exp(-dt * 4); p.vy *= Math.exp(-dt * 3); }
  }
  G.particles = G.particles.filter(p => p.t < p.life);
  for (const tx of G.texts) tx.t += dt;
  G.texts = G.texts.filter(tx => tx.t < tx.life);
  if (G.bubble) { G.bubble.t += dt; if (G.bubble.t > G.bubble.dur) G.bubble = null; }
  if (G.banner) { G.banner.t += dt; if (G.banner.t > 1.3) G.banner = null; }
}
function update(rdt) {
  if (G.slowT > 0) { G.slowT -= rdt; if (G.slowT <= 0) G.slow = 1; }
  G.flash = Math.max(0, G.flash - rdt * 2.5);
  G.shake *= Math.exp(-rdt * 9);
  G.comboPop = Math.max(0, G.comboPop - rdt * 5);
  G.dim = lerp(G.dim, P.act && P.act.m.ultimate ? 0.62 : 0, 1 - Math.exp(-rdt * 8));
  if (G.ko) {
    G.koT += rdt; G.stringCut += rdt;
    if (G.koT > 4 && !G.endShown) showEnd();
  }
  if (G.hitstop > 0) { G.hitstop -= rdt; return; }
  const dt = rdt * G.slow;
  G.t += dt;
  updatePlayer(dt);
  updateOpp(dt);
  separate();
  P.J = solveBody(P, PD);
  O.J = solveBody(O, OD);
  updateFx(dt);
  G.comboT -= dt;
  if (G.comboT <= 0) G.combo = 0;
  // puppet control bar sways after the body
  const bt = O.hold ? O.hold.x : O.x;
  G.bar.v += ((bt - G.bar.x) * 40 - G.bar.v * 6) * dt;
  G.bar.x += G.bar.v * dt;
  // idle begging
  if (!G.ko) {
    G.bubbleCD -= dt;
    if (G.bubbleCD <= 0 && (O.state === 'idle' || O.state === 'getup')) {
      const line = pick(BEG[O.stage]);
      setBubble(line, true); speak(line, O.stage / 4);
      G.bubbleCD = rand(2.6, 4.2) - O.stage * 0.3;
    }
  } else if (O.state === 'ko') {
    G.sobCD -= dt;
    if (G.sobCD <= 0) { setBubble(pick(KO_SOB), true); G.sobCD = 1.8; }
    if (Math.random() < dt * 6) {
      const J = O.J;
      G.particles.push({ type: 'drop', x: J.head[0] + rand(-20, 20), y: J.head[1] - 10, vx: rand(-120, 120), vy: rand(-300, -150), g: 1300, life: 1, t: 0, size: rand(3, 5), color: '#7cc8ff' });
    }
  }
  $('#btn-chain').classList.toggle('ready', G.meter >= 100);
}

/* ------------------------------------------------------------------ render */
const bg = mk(W + 40, H + 40);
(function drawBg() {
  const x = bg.getContext('2d'), w = bg.width, h = bg.height, gy = GY + 20;
  const sky = x.createLinearGradient(0, 0, 0, gy);
  sky.addColorStop(0, '#140c2b'); sky.addColorStop(0.55, '#4f2468'); sky.addColorStop(1, '#f2874a');
  x.fillStyle = sky; x.fillRect(0, 0, w, h);
  const sun = x.createRadialGradient(w * 0.72, gy - 170, 10, w * 0.72, gy - 170, 140);
  sun.addColorStop(0, 'rgba(255,225,140,1)'); sun.addColorStop(0.45, 'rgba(255,170,90,0.85)'); sun.addColorStop(1, 'rgba(255,120,80,0)');
  x.fillStyle = sun; x.beginPath(); x.arc(w * 0.72, gy - 170, 140, 0, TAU); x.fill();
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [col, minH, maxH, win] of [['#2c1a45', 90, 230, 0.08], ['#1a1030', 60, 170, 0.18]]) {
    let bx = -10;
    while (bx < w) {
      const bw = 40 + rnd() * 70, bh = minH + rnd() * (maxH - minH);
      x.fillStyle = col; x.fillRect(bx, gy - 40 - bh, bw, bh + 40);
      for (let wy = gy - 30 - bh; wy < gy - 50; wy += 14) for (let wx = bx + 6; wx < bx + bw - 8; wx += 12) {
        if (rnd() < win) { x.fillStyle = rnd() < 0.7 ? 'rgba(255,214,120,0.85)' : 'rgba(140,220,255,0.7)'; x.fillRect(wx, wy, 5, 7); }
      }
      bx += bw + 2;
    }
  }
  // neon sign
  x.save(); x.font = `900 26px ${FONT}`; x.textAlign = 'center'; x.shadowColor = '#ff3d8b'; x.shadowBlur = 18; x.fillStyle = '#ffd1e4';
  x.fillText('出氣大樓', w * 0.22, gy - 220); x.restore();
  // railing
  x.strokeStyle = 'rgba(20,12,35,0.9)'; x.lineWidth = 4;
  x.beginPath(); x.moveTo(0, gy - 58); x.lineTo(w, gy - 58); x.moveTo(0, gy - 34); x.lineTo(w, gy - 34); x.stroke();
  for (let px = 10; px < w; px += 46) { x.beginPath(); x.moveTo(px, gy - 62); x.lineTo(px, gy - 10); x.stroke(); }
  // floor
  const fl = x.createLinearGradient(0, gy - 10, 0, h);
  fl.addColorStop(0, '#463e5e'); fl.addColorStop(1, '#17131f');
  x.fillStyle = fl; x.fillRect(0, gy - 10, w, h - gy + 10);
  x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 2;
  for (let i = -12; i <= 12; i++) { x.beginPath(); x.moveTo(w / 2 + i * 50, gy - 10); x.lineTo(w / 2 + i * 150, h); x.stroke(); }
  for (const yy of [gy + 8, gy + 26, gy + 52]) { x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke(); }
  x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, gy - 10, w, 3);
})();

function seg(a, b, w, col) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#120d1a'; ctx.lineWidth = w + 5;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}
function dot(p, r, col) {
  ctx.fillStyle = col; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill(); ctx.stroke();
}
function foot(J, k, col) {
  const p = J[k], v = J.footVec;
  seg(p, [p[0] + v[0] * 12, p[1] + v[1] * 12], 9, col);
}
function shadow(x, h, w) {
  const s = clamp(1 - h / 400, 0.3, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.35 * s})`;
  ctx.beginPath(); ctx.ellipse(x, GY + 4, w * s, 9 * s, 0, 0, TAU); ctx.fill();
}

function drawPlayer() {
  // 經典格鬥家造型：白色道服（扯掉袖子）、黑帶、飄揚頭帶、綁手帶、赤腳
  const J = P.J, SK = '#d99a6c', SKD = '#b97e55', GI = '#f4f1e8', GID = '#d6d1c4', BELT = '#16131c', BAND = '#e8a317', WRAP = '#efe9da';
  const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const hand = (k, open, dark) => {
    const p = J[k], e = J[k === 'hF' ? 'eF' : 'eB'];
    if (open) {
      const a = Math.atan2(p[1] - e[1], p[0] - e[0]);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a);
      ctx.fillStyle = dark ? SKD : SK; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(6, 0, 14, 10, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.5; for (const o of [-5, 0, 5]) { ctx.beginPath(); ctx.moveTo(10, o); ctx.lineTo(19, o * 1.3); ctx.stroke(); }
      ctx.restore();
    } else {
      dot(p, 10, dark ? GID : WRAP);
      ctx.strokeStyle = 'rgba(18,13,26,0.45)'; ctx.lineWidth = 1.5;
      for (const o of [-3.5, 3.5]) { ctx.beginPath(); ctx.arc(p[0], p[1], 10, Math.PI * 0.5 + o * 0.1 - 0.9, Math.PI * 0.5 + o * 0.1 + 0.9); ctx.stroke(); }
    }
    // 手腕綁帶
    seg(lerp2(e, p, 0.72), lerp2(e, p, 0.86), dark ? 12 : 13, dark ? GID : WRAP);
  };
  const arm = (e, h, dark) => {
    seg(J.sh, J[e], dark ? 13 : 14, dark ? SKD : SK);
    seg(J.sh, lerp2(J.sh, J[e], 0.32), dark ? 18 : 19, dark ? GID : GI); // 破袖口
    seg(J[e], J[h], dark ? 12 : 13, dark ? SKD : SK);
  };
  const leg = (k, f, back) => {
    const col = back ? GID : GI;
    seg(J.hip, J[k], 20, col); seg(J[k], lerp2(J[k], J[f], 0.82), 19, col);
    // 赤腳
    const p = J[f], v = J.footVec;
    seg(lerp2(J[k], p, 0.8), p, 10, back ? SKD : SK);
    seg(p, [p[0] + v[0] * 13, p[1] + v[1] * 13], 9, back ? SKD : SK);
  };
  arm('eB', 'hB', true); hand('hB', P.open === 'B', true);
  leg('kB', 'fB', true);
  // 道服上衣
  seg(J.hip, J.neck, 32, GI);
  const tv = [J.neck[0] - J.hip[0], J.neck[1] - J.hip[1]], tl = Math.hypot(tv[0], tv[1]) || 1;
  const ux = tv[0] / tl, uy = tv[1] / tl, nx = -uy * P.f, ny = ux * P.f;
  const at = (k, side) => [J.hip[0] + tv[0] * k + nx * side, J.hip[1] + tv[1] * k + ny * side];
  // 交領：露出胸口的 V 字
  ctx.fillStyle = SK; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 2;
  const n1 = at(1.02, -9), n2 = at(1.02, 10), v0 = at(0.5, 2);
  ctx.beginPath(); ctx.moveTo(n1[0], n1[1]); ctx.lineTo(n2[0], n2[1]); ctx.lineTo(v0[0], v0[1]); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(n1[0], n1[1]); ctx.lineTo(v0[0], v0[1]); ctx.lineTo(at(0.18, -12)[0], at(0.18, -12)[1]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(n2[0], n2[1]); ctx.lineTo(v0[0], v0[1]); ctx.stroke();
  // 黑帶 + 飄動的帶尾
  { const a = at(0.13, 0), b = at(0.22, 0); ctx.lineCap = 'butt';
    ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 36; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.strokeStyle = BELT; ctx.lineWidth = 33; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  const knot = at(0.175, 8), sw = Math.sin(G.t * 9) * 4, run = -P.f * (P.air ? 6 : 0);
  ctx.strokeStyle = BELT; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const [dx, len] of [[-3, 22], [4, 18]]) {
    ctx.beginPath(); ctx.moveTo(knot[0], knot[1]);
    ctx.quadraticCurveTo(knot[0] + dx + run, knot[1] + len * 0.6, knot[0] + dx * 1.6 + sw + run * 2, knot[1] + len); ctx.stroke();
  }
  leg('kF', 'fF', false);
  arm('eF', 'hF', false); hand('hF', P.open === 'F', false);
  // head
  const r = PD.headR;
  ctx.save(); ctx.translate(J.head[0], J.head[1]); ctx.rotate(J.headAngle); ctx.scale(P.f, 1);
  // 頭帶尾巴（畫在頭後面，隨風飄）
  const t = G.t * 10, lift = (P.air || P.act) ? 0.35 : 0;
  ctx.strokeStyle = '#120d1a'; ctx.lineCap = 'round';
  for (const [i, L] of [[0, 34], [1, 28]]) {
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const q = k / 6;
      pts.push([-r * 0.85 - q * L, -r * 0.42 + q * L * (0.35 - lift + i * 0.25) + Math.sin(t + q * 4 + i) * 5 * q]);
    }
    for (const [lw, col] of [[9, '#120d1a'], [5.5, BAND]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (const pt of pts) ctx.lineTo(pt[0], pt[1]); ctx.stroke();
    }
  }
  ctx.fillStyle = '#15121f'; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  const spikes = [[-1.1, -0.1], [-1.4, -0.55], [-0.85, -0.75], [-0.95, -1.3], [-0.3, -1.0], [0.05, -1.4], [0.45, -0.95], [0.95, -1.0], [0.95, -0.35]];
  ctx.moveTo(spikes[0][0] * r, spikes[0][1] * r); for (const [sx, sy] of spikes) ctx.lineTo(sx * r, sy * r); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = SK; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#15121f'; ctx.beginPath(); ctx.arc(0, 0, r, Math.PI * 1.02, Math.PI * 1.9); ctx.lineTo(-r * 0.3, -r * 0.35); ctx.closePath(); ctx.fill();
  // 頭帶
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r + 1, 0, TAU); ctx.clip();
  ctx.fillStyle = BAND; ctx.beginPath(); ctx.moveTo(-r * 1.1, -r * 0.58); ctx.lineTo(r * 1.1, -r * 0.52); ctx.lineTo(r * 1.1, -r * 0.24); ctx.lineTo(-r * 1.1, -r * 0.28); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = BAND; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-r * 0.88, -r * 0.42, 4.5, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = SKD; ctx.beginPath(); ctx.arc(-r * 0.15, 0.1 * r, r * 0.2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(r * 0.5, -r * 0.04, r * 0.22, r * 0.12, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.02, r * 0.08, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(r * 0.22, -r * 0.2); ctx.lineTo(r * 0.82, -r * 0.12); ctx.stroke();
  if (P.act || G.ko) { ctx.fillStyle = '#4a1010'; ctx.beginPath(); ctx.ellipse(r * 0.58, r * 0.45, r * 0.2, r * 0.15, 0, 0, TAU); ctx.fill(); }
  else { ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(r * 0.38, r * 0.48); ctx.lineTo(r * 0.78, r * 0.4); ctx.stroke(); }
  ctx.restore();
}

function drawOpp() {
  const J = O.J, SUIT = '#2d3040', SUITD = '#22242f', SK = face.skin;
  seg(J.sh, J.eB, 14, SUITD); seg(J.eB, J.hB, 12, SUITD); dot(J.hB, 7, SK);
  seg(J.hip, J.kB, 17, '#1d1f28'); seg(J.kB, J.fB, 15, '#1d1f28'); foot(J, 'fB', '#4a3020');
  seg(J.hip, J.neck, 32, SUIT);
  // shirt + tie
  const dx = J.hip[0] - J.neck[0], dy = J.hip[1] - J.neck[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const n = J.neck;
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath(); ctx.moveTo(n[0] - uy * 9, n[1] + ux * 9); ctx.lineTo(n[0] + uy * 9, n[1] - ux * 9); ctx.lineTo(n[0] + ux * 22, n[1] + uy * 22); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#c1121f'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  const sway = Math.sin(G.t * 6) * 0.1 + O.headRot * 0.3;
  ctx.beginPath(); ctx.moveTo(n[0] + ux * 3, n[1] + uy * 3); ctx.lineTo(n[0] + ux * 34 + uy * sway * 20, n[1] + uy * 34 - ux * sway * 20); ctx.stroke();
  seg(J.hip, J.kF, 17, '#262833'); seg(J.kF, J.fF, 15, '#262833'); foot(J, 'fF', '#5a3d2b');
  seg(J.sh, J.eF, 15, SUIT); seg(J.eF, J.hF, 13, SUIT); dot(J.hF, 7, SK);
  drawOppHead(J);
}

function drawFaceImg(src, R, wob) {
  if (wob > 0.01) {
    const N = 24, sh = FS / N, dh = (2 * R) / N;
    for (let i = 0; i < N; i++) {
      const off = Math.sin(G.t * 14 + i * 0.9) * wob * R * 0.09;
      ctx.drawImage(src, 0, i * sh, FS, sh, -R + off, -R + i * dh, 2 * R, dh + 0.6);
    }
  } else ctx.drawImage(src, -R, -R, 2 * R, 2 * R);
}
function teardrop(x, y, s) {
  ctx.beginPath(); ctx.moveTo(x, y - s);
  ctx.bezierCurveTo(x + s * 0.9, y + s * 0.2, x + s * 0.6, y + s, x, y + s);
  ctx.bezierCurveTo(x - s * 0.6, y + s, x - s * 0.9, y + s * 0.2, x, y - s);
  ctx.fill();
}
function drawMark(m, R) {
  const x = m.u * R, y = m.v * R;
  if (m.type === 'hand') {
    const s = 0.4 * R * m.s, a = Math.max(0.35, 0.62 - (G.t - m.born) * 0.01);
    ctx.save(); ctx.translate(x, y); ctx.rotate(m.rot); ctx.fillStyle = `rgba(225,25,45,${a})`;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.45, s * 0.4, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(-s * 0.33 + i * s * 0.22, -s * 0.68, s * 0.085, s * 0.32, (i - 1.5) * 0.12, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(s * 0.5, -s * 0.08, s * 0.08, s * 0.28, -0.9, 0, TAU); ctx.fill();
    ctx.restore();
  } else if (m.type === 'bruise') {
    const r = 0.2 * R * m.s, g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(85,25,115,0.75)'); g.addColorStop(0.6, 'rgba(120,40,110,0.45)'); g.addColorStop(1, 'rgba(160,60,90,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  } else if (m.type === 'black') {
    ctx.strokeStyle = 'rgba(55,15,75,0.72)'; ctx.lineWidth = R * 0.11 * m.s;
    ctx.beginPath(); ctx.ellipse(x, y, R * 0.17, R * 0.12, 0, 0, TAU); ctx.stroke();
  }
}
const HL = 192, headLayer = mk(HL, HL), hudLayer = mk(56, 56);
function drawOppHead(J) {
  const R = OD.headR, d = G.ko ? 1 : dmgRatio(), t = G.t;
  const tremble = O.state === 'idle' ? (0.6 + O.stage * 0.6) : 0;
  ctx.save();
  ctx.translate(J.head[0] + rand(-tremble, tremble), J.head[1] + rand(-tremble, tremble) * 0.5);
  ctx.rotate(J.headAngle + O.headRot);
  ctx.scale(1 - O.squash * 0.35, 1 + O.squash * 0.15);
  // lumps behind the outline
  for (const l of O.lumps) {
    const lx = Math.cos(l.a) * R * 0.88, ly = Math.sin(l.a) * R * 0.88, lr = R * 0.22 * l.s;
    ctx.fillStyle = face.skin; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(lx, ly, lr, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(220,60,60,0.35)'; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(lx - lr * 0.3, ly - lr * 0.3, lr * 0.25, 0, TAU); ctx.fill();
  }
  const wob = G.ko ? 1 : clamp((d - 0.78) / 0.22, 0, 1);
  const lc = headLayer.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, HL, HL);
  lc.setTransform(HL / (2 * R), 0, 0, HL / (2 * R), HL / 2, HL / 2);
  ctx = lc;
  ctx.save();
  drawFaceImg(face.canvas, R, wob);
  const gA = G.ko ? 0.9 : clamp((d - 0.35) / 0.6, 0, 1) * 0.75;
  if (gA > 0) { ctx.globalAlpha = gA; drawFaceImg(face.gray, R, wob); ctx.globalAlpha = 1; }
  for (const m of O.marks) drawMark(m, R);
  if (d > 0.6) { ctx.fillStyle = `rgba(110,170,110,${(d - 0.6) * 0.35})`; ctx.fillRect(-R, -R, 2 * R, 2 * R); }
  // worried brows
  if (d > 0.18) {
    const a = Math.min(1, (d - 0.18) * 4);
    ctx.strokeStyle = `rgba(40,25,20,${0.85 * a})`; ctx.lineWidth = R * 0.07; ctx.lineCap = 'round';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 0.12 * R, -0.38 * R); ctx.lineTo(s * 0.5 * R, -0.26 * R); ctx.stroke(); }
  }
  // tears streaming
  if (d > 0.28) {
    const a = Math.min(1, (d - 0.28) * 3), w = R * (0.05 + d * 0.08);
    for (const s of [-1, 1]) {
      ctx.strokeStyle = `rgba(120,200,255,${0.7 * a})`; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(s * 0.32 * R, 0.0);
      for (let k = 1; k <= 11; k++) ctx.lineTo(s * 0.32 * R + s * k * 0.012 * R + Math.sin(t * 8 + k) * 0.02 * R, k * 0.09 * R);
      ctx.stroke();
      ctx.fillStyle = `rgba(150,215,255,${0.85 * a})`;
      teardrop(s * 0.34 * R, ((t * 0.9 + (s > 0 ? 0.5 : 0)) % 1) * R * 0.9 + 0.05 * R, R * 0.06);
    }
  }
  // nosebleed
  if (d > 0.5) {
    ctx.strokeStyle = 'rgba(190,0,0,0.85)'; ctx.lineWidth = R * 0.05;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 0.06 * R, 0.2 * R); ctx.lineTo(s * 0.07 * R, (0.34 + Math.sin(t * 3 + s) * 0.03 + (d - 0.5) * 0.25) * R); ctx.stroke(); }
  }
  // wailing mouth
  if (d > 0.62) {
    const open = (0.1 + 0.05 * Math.sin(t * 11) + (d - 0.62) * 0.25) * R;
    ctx.save(); ctx.translate(0, 0.46 * R);
    ctx.beginPath(); ctx.ellipse(0, 0, 0.26 * R, open, 0, 0, TAU);
    ctx.fillStyle = 'rgba(60,8,12,0.95)'; ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(-0.2 * R, -open, 0.4 * R, open * 0.38);
    ctx.fillStyle = '#e0607a'; ctx.beginPath(); ctx.ellipse(0, open * 0.85, 0.16 * R, open * 0.5, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // bandage
  if (d > 0.45) {
    ctx.save(); ctx.translate(-0.4 * R, -0.58 * R);
    for (const r of [0.6, -0.6]) {
      ctx.save(); ctx.rotate(r); ctx.fillStyle = '#e8c9a0'; ctx.strokeStyle = '#a78559'; ctx.lineWidth = 1.5;
      ctx.fillRect(-0.32 * R, -0.08 * R, 0.64 * R, 0.16 * R); ctx.strokeRect(-0.32 * R, -0.08 * R, 0.64 * R, 0.16 * R);
      ctx.fillStyle = '#f6e3c8'; ctx.fillRect(-0.09 * R, -0.08 * R, 0.18 * R, 0.16 * R);
      ctx.restore();
    }
    ctx.restore();
  }
  // spiral eyes — mind is gone
  if (d > 0.85) {
    for (const s of [-1, 1]) {
      const ex = s * 0.32 * R, ey = -0.1 * R;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, 0.16 * R, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath();
      for (let a = 0; a < 4 * Math.PI; a += 0.25) {
        const rr = (a / (4 * Math.PI)) * 0.14 * R, aa = a + t * 8 * s;
        const px = ex + Math.cos(aa) * rr, py = ey + Math.sin(aa) * rr;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  // cracks
  if (O.cracks) {
    ctx.strokeStyle = 'rgba(20,10,10,0.85)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'miter';
    for (const pts of O.cracks) { ctx.beginPath(); pts.forEach(([u, v], i) => (i ? ctx.lineTo(u * R, v * R) : ctx.moveTo(u * R, v * R))); ctx.stroke(); }
  }
  if (O.hitFlash > 0) { ctx.fillStyle = `rgba(255,50,50,${O.hitFlash * 0.4})`; ctx.fillRect(-R, -R, 2 * R, 2 * R); }
  // keep everything inside the head's own silhouette
  ctx.globalCompositeOperation = 'destination-in';
  drawFaceImg(face.canvas, R, wob);
  ctx.restore();
  ctx = mainCtx;
  ctx.drawImage(headLayer, -R, -R, 2 * R, 2 * R);
  // sweat
  if (d > 0.06 && !G.ko) {
    ctx.fillStyle = 'rgba(160,215,255,0.9)';
    teardrop(0.6 * R, -0.55 * R + ((t * 0.7) % 1) * 0.45 * R, R * 0.08);
    if (d > 0.3) teardrop(-0.66 * R, -0.4 * R + ((t * 0.55 + 0.4) % 1) * 0.4 * R, R * 0.07);
  }
  ctx.restore();
  // dizzy stars
  if (d > 0.72 || O.state === 'down' || O.state === 'ko') {
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + (i * TAU) / 3;
      star(J.head[0] + Math.cos(a) * R * 0.95, J.head[1] - R * 0.95 + Math.sin(a) * R * 0.25, 8, '#ffe14d');
    }
  }
}
function star(x, y, r, col) {
  ctx.fillStyle = col; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
function headTop(J, R) { return [J.head[0] + Math.sin(J.headAngle + O.headRot) * R, J.head[1] - Math.cos(J.headAngle + O.headRot) * R]; }
function drawStrings() {
  const J = O.J, bx = G.bar.x, by = 26, tilt = clamp(G.bar.v * 0.0015, -0.4, 0.4);
  const ends = [[bx - Math.cos(tilt) * 55, by - Math.sin(tilt) * 55], [bx + Math.cos(tilt) * 55, by + Math.sin(tilt) * 55], [bx, by]];
  const targets = [O.f > 0 ? J.hB : J.hF, O.f > 0 ? J.hF : J.hB, headTop(J, OD.headR)];
  const cut = G.stringCut;
  ctx.strokeStyle = 'rgba(235,230,215,0.75)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const [ex, ey] = ends[i], [tx, ty] = targets[i];
    ctx.beginPath(); ctx.moveTo(ex, ey);
    if (cut < 0) ctx.lineTo(tx, ty);
    else {
      const k = Math.max(0, 1 - cut * 1.2), lx = lerp(ex, tx, k), ly = lerp(ey, ty, k);
      ctx.quadraticCurveTo(lerp(ex, lx, 0.5) + Math.sin(cut * 9 + i) * 20 * k, lerp(ey, ly, 0.5), lx, ly);
    }
    ctx.stroke();
  }
  ctx.save(); ctx.translate(bx, by); ctx.rotate(tilt);
  ctx.fillStyle = '#7a5230'; ctx.strokeStyle = '#2a1a0d'; ctx.lineWidth = 2;
  ctx.fillRect(-60, -5, 120, 10); ctx.strokeRect(-60, -5, 120, 10);
  ctx.fillRect(-5, -22, 10, 34); ctx.strokeRect(-5, -22, 10, 34);
  ctx.restore();
}
function drawParticles() {
  for (const p of G.particles) {
    const k = p.t / p.life;
    if (p.type === 'spark') {
      ctx.strokeStyle = p.color; ctx.lineWidth = 3 * (1 - k) + 1; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
    } else if (p.type === 'ring') {
      ctx.strokeStyle = p.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + p.r1 * easeOut(k), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    } else if (p.type === 'drop') {
      ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    } else if (p.type === 'dust') {
      ctx.fillStyle = `rgba(200,190,220,${0.45 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + k * 1.5), 0, TAU); ctx.fill();
    } else if (p.type === 'tooth') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = '#fffdf2'; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(5, -6); ctx.lineTo(4, 3); ctx.lineTo(2, 7); ctx.lineTo(0, 2); ctx.lineTo(-2, 7); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
}
function outlinedText(text, x, y, size, fill, stroke = '#120d1a', lw = 0) {
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.lineWidth = lw || size * 0.16;
  ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function drawTexts() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const tx of G.texts) {
    const k = tx.t / tx.life, s = tx.t < 0.08 ? lerp(2.2, 1, tx.t / 0.08) : 1;
    ctx.save(); ctx.translate(tx.x, tx.y - k * 40); ctx.rotate(tx.rot); ctx.scale(s, s);
    ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    outlinedText(tx.text, 0, 0, tx.size, tx.color);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}
function wrapText(text, maxW) {
  const lines = []; let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawBubble() {
  const b = G.bubble; if (!b) return;
  const a = Math.min(1, b.t * 10, (b.dur - b.t) * 5);
  ctx.save(); ctx.globalAlpha = a;
  ctx.font = `900 ${b.size}px ${FONT}`;
  const lines = wrapText(b.text, 240);
  const lh = b.size * 1.25, w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 30, h = lines.length * lh + 18;
  const hx = O.J.head[0], hy = O.J.head[1] - OD.headR;
  const sh = O.stage >= 3 || G.ko ? 2.5 : 0;
  const x = clamp(hx, w / 2 + 10, W - w / 2 - 10) + rand(-sh, sh), y = clamp(hy - 30 - h, 70, H - h - 10) + rand(-sh, sh);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 3;
  roundRect(x - w / 2, y, w, h, 16); ctx.fill(); ctx.stroke();
  const tx = clamp(hx, x - w / 2 + 20, x + w / 2 - 20);
  ctx.beginPath(); ctx.moveTo(tx - 10, y + h - 2); ctx.lineTo(tx + rand(-1, 1), Math.min(hy - 4, y + h + 22)); ctx.lineTo(tx + 10, y + h - 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(tx - 9, y + h - 5, 18, 5);
  ctx.fillStyle = O.stage >= 3 || G.ko ? '#b3001b' : '#120d1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x, y + 9 + lh * (i + 0.5)));
  ctx.restore(); ctx.textBaseline = 'alphabetic';
}
function drawSoul() {
  if (O.state !== 'ko' || O.st < 0.6) return;
  const k = O.st - 0.6, J = O.J;
  const x = J.head[0] + Math.sin(k * 3) * 16, y = J.head[1] - 30 - k * 50;
  if (y < -100) return;
  ctx.save(); ctx.globalAlpha = Math.min(0.85, k * 2);
  ctx.fillStyle = 'rgba(235,245,255,0.9)'; ctx.strokeStyle = 'rgba(150,170,220,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 28, Math.PI, 0);
  ctx.quadraticCurveTo(x + 28, y + 40, x + 6 + Math.sin(k * 8) * 10, y + 70);
  ctx.quadraticCurveTo(x - 10, y + 40, x - 28, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.globalAlpha *= 0.65; ctx.drawImage(face.gray, x - 19, y - 17, 38, 38);
  ctx.restore();
}
function drawHUD() {
  const bw = 330, bx = W - bw - 22, by = 26;
  // portrait
  const px = bx - 40, py = by + 14;
  const hc = hudLayer.getContext('2d');
  hc.clearRect(0, 0, 56, 56); hc.globalCompositeOperation = 'source-over';
  hc.drawImage(face.canvas, 0, 0, 56, 56);
  const gA = G.ko ? 0.9 : clamp((dmgRatio() - 0.35) / 0.6, 0, 1) * 0.75;
  if (gA > 0) { hc.globalAlpha = gA; hc.drawImage(face.gray, 0, 0, 56, 56); hc.globalAlpha = 1; }
  if (O.hitFlash > 0) { hc.globalCompositeOperation = 'source-atop'; hc.fillStyle = `rgba(255,40,40,${O.hitFlash * 0.5})`; hc.fillRect(0, 0, 56, 56); hc.globalCompositeOperation = 'source-over'; }
  ctx.drawImage(hudLayer, px - 28, py - 28, 56, 56);
  ctx.textAlign = 'left';
  outlinedText(face.name, bx, by - 4, 20, '#fff', '#120d1a', 5);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 3, by + 3, bw + 6, 24);
  ctx.fillStyle = '#fff'; ctx.fillRect(bx, by + 6, bw * (O.ghostHp / O.maxHp), 18);
  const r = O.hp / O.maxHp;
  const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, r > 0.5 ? '#ffb300' : '#ff2d2d'); g.addColorStop(1, r > 0.5 ? '#ffe14d' : '#ff7a00');
  ctx.fillStyle = g; ctx.fillRect(bx, by + 6, bw * r, 18);
  ctx.strokeStyle = '#120d1a'; ctx.lineWidth = 2; ctx.strokeRect(bx - 3, by + 3, bw + 6, 24);
  ctx.textAlign = 'right'; outlinedText('尊嚴', bx + bw - 6, by + 21, 14, '#fff', '#120d1a', 4);
  ctx.textAlign = 'left';
  outlinedText('精神狀態:' + (G.ko ? '徹底崩潰' : STAGE_NAME[O.stage]), bx, by + 48, 15, O.stage >= 3 || G.ko ? '#ff6b6b' : '#ddd', '#120d1a', 4);

  // rage meter
  const mx = 22, my = H - 36, mw = 250;
  outlinedText('怒氣', mx, my - 6, 16, '#fff', '#120d1a', 4);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(mx - 2, my, mw + 4, 16);
  const full = G.meter >= 100;
  ctx.fillStyle = full ? (Math.sin(performance.now() / 70) > 0 ? '#ffe14d' : '#ff3b3b') : '#3fa9ff';
  ctx.fillRect(mx, my + 2, (mw * G.meter) / 100, 12);
  ctx.strokeStyle = '#120d1a'; ctx.strokeRect(mx - 2, my, mw + 4, 16);
  if (full && !G.ko) outlinedText('按 U / 空白鍵:終極連環技!', mx + mw + 14, my + 14, 16, '#ffe14d', '#120d1a', 4);

  // stats
  outlinedText(`總打擊 ${G.hits}`, 22, 34, 18, '#fff', '#120d1a', 4);

  // combo
  if (G.combo >= 2) {
    const s = 1 + G.comboPop * 0.4;
    ctx.save(); ctx.translate(70, 150); ctx.scale(s, s); ctx.rotate(-0.08); ctx.textAlign = 'center';
    outlinedText(String(G.combo), 0, 0, 64, G.combo >= 10 ? '#ff3b3b' : '#ffe14d');
    outlinedText('連擊!', 0, 36, 24, '#fff');
    ctx.restore();
  }
  // banner
  if (G.banner) {
    const b = G.banner, k = b.t / 1.3;
    const x = k < 0.15 ? lerp(-300, W / 2, easeOut(k / 0.15)) : k > 0.85 ? lerp(W / 2, W + 400, (k - 0.85) / 0.15) : W / 2;
    ctx.save(); ctx.translate(x, H * 0.3); ctx.transform(1, 0, -0.2, 1, 0, 0);
    ctx.fillStyle = b.ult ? 'rgba(180,0,20,0.85)' : 'rgba(0,0,0,0.6)'; ctx.fillRect(-W, -34, W * 2, 68);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    outlinedText(b.text, 0, 2, b.ult ? 52 : 44, b.ult ? '#ffe14d' : '#fff');
    ctx.restore(); ctx.textBaseline = 'alphabetic';
  }
  // KO
  if (G.ko && G.koT > 0.25) {
    const k = Math.min(1, (G.koT - 0.25) * 4), s = lerp(3, 1, easeOut(k));
    ctx.save(); ctx.translate(W / 2 + rand(-3, 3), H * 0.36 + rand(-3, 3)); ctx.scale(s, s); ctx.rotate(-0.06);
    ctx.globalAlpha = k; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    outlinedText('崩潰!!', 0, 0, 110, '#ff2d2d', '#fff', 14);
    outlinedText('崩潰!!', 0, 0, 110, '#ff2d2d', '#120d1a', 6);
    outlinedText('K.O.', 0, 78, 46, '#ffe14d');
    ctx.restore(); ctx.textBaseline = 'alphabetic';
  }
}
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const sx = G.shake > 0.3 ? rand(-1, 1) * G.shake : 0, sy = G.shake > 0.3 ? rand(-1, 1) * G.shake : 0;
  ctx.save(); ctx.translate(sx, sy);
  ctx.drawImage(bg, -20, -20);
  if (G.dim > 0.01) {
    ctx.fillStyle = `rgba(10,0,20,${G.dim})`; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.strokeStyle = `rgba(255,220,120,${G.dim * 0.35})`; ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU), r0 = rand(260, 340);
      ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); ctx.lineTo(W / 2 + Math.cos(a) * 800, H / 2 + Math.sin(a) * 800); ctx.stroke();
    }
  }
  if (P.J && O.J) {
    shadow(O.hold ? O.hold.x : O.x, O.hold ? GY - O.hold.y : O.h, 46);
    shadow(P.x, P.h, 42);
    drawStrings();
    drawOpp();
    drawPlayer();
    drawParticles();
    drawSoul();
    drawTexts();
    drawBubble();
  }
  ctx.restore();
  if (P.J) drawHUD();
  if (G.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.7})`; ctx.fillRect(0, 0, W, H); }
}

/* ------------------------------------------------------------------ loop */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (G.running) update(rdt);
  render();
}

/* ------------------------------------------------------------------ UI */
function showEnd() {
  G.endShown = true;
  const secs = ((performance.now() - G.startTime) / 1000).toFixed(1);
  $('#end-title').textContent = `${face.name} 徹底崩潰了!`;
  $('#end-sub').textContent = pick(END_SUB);
  $('#end-stats').innerHTML = `總共打了 <b>${G.hits}</b> 下・最高 <b>${G.maxCombo}</b> 連擊<br>用時 <b>${secs}</b> 秒`;
  $('#end').classList.add('show');
}
function startGame() {
  audio();
  finalizeFace();
  face.name = $('#name').value.trim() || '那個混蛋';
  $('#setup').classList.remove('show');
  $('#end').classList.remove('show');
  resetGame();
  G.running = true;
  const line = pick(BEG[0]);
  setTimeout(() => { if (G.running && !G.ko) { setBubble(line, true); speak(line, 0, true); } }, 400);
}
function openSetup() {
  G.running = false;
  if (hasTTS) speechSynthesis.cancel();
  $('#end').classList.remove('show');
  $('#setup').classList.add('show');
  drawEditor();
}

// editor interactions
const pointers = new Map();
let dragStart = null, pinchStart = null;
const edScale = () => ES / (edC.clientWidth || ES);
edC.addEventListener('pointerdown', e => {
  edC.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 1) dragStart = { x: e.clientX, y: e.clientY, ox: ed.ox, oy: ed.oy };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: ed.zoom };
  }
});
edC.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    ed.zoom = clamp(pinchStart.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinchStart.d, ZMIN, ZMAX);
    $('#zoom').value = ed.zoom;
  } else if (dragStart) {
    const k = edScale();
    ed.ox = dragStart.ox + (e.clientX - dragStart.x) * k;
    ed.oy = dragStart.oy + (e.clientY - dragStart.y) * k;
  }
  drawEditor();
});
const endPointer = e => {
  pointers.delete(e.pointerId);
  pinchStart = null;
  if (pointers.size === 1) { const [p] = [...pointers.values()]; dragStart = { x: p[0], y: p[1], ox: ed.ox, oy: ed.oy }; }
  else dragStart = null;
};
edC.addEventListener('pointerup', endPointer);
edC.addEventListener('pointercancel', endPointer);
edC.addEventListener('wheel', e => {
  e.preventDefault();
  ed.zoom = clamp(ed.zoom * Math.exp(-e.deltaY * 0.0015), ZMIN, ZMAX);
  $('#zoom').value = ed.zoom; drawEditor();
}, { passive: false });
$('#zoom').addEventListener('input', e => { ed.zoom = +e.target.value; drawEditor(); });
$('#rotate').addEventListener('input', e => { ed.rot = (+e.target.value * Math.PI) / 180; drawEditor(); });
/* auto face alignment: detect eyes + mouth locally (MediaPipe, runs in the browser)
   and fit a similarity transform that drops them onto the dashed guides */
const MP_VER = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
let detectorP = null;
function getDetector() {
  if (!detectorP) {
    detectorP = (async () => {
      const { FaceDetector, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL }, runningMode: 'IMAGE', minDetectionConfidence: 0.4,
      });
    })();
    detectorP.catch(() => { detectorP = null; });
  }
  return detectorP;
}
// returns {eyeL, eyeR, mouth} in image pixels (eyeL = left side of the picture), or null
async function detectFace(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  try {
    const det = await getDetector();
    // the short-range model wants the face to fill a good part of the frame: try the
    // whole picture first, then overlapping crops for faces in wider shots
    const tries = [[0, 0, iw, ih]];
    const m = Math.min(iw, ih), cs = [m * 0.6, m * 0.4];
    for (const c of cs) for (let y = 0; y + c <= ih + 1; y += c / 2) for (let x = 0; x + c <= iw + 1; x += c / 2) tries.push([x, y, c, c]);
    const tmp = mk(1, 1), tx = tmp.getContext('2d');
    let best = null;
    for (const [sx, sy, sw, sh] of tries) {
      let src = img, ox = 0, oy = 0, w = iw, h = ih;
      if (sw !== iw || sh !== ih) {
        const k = Math.min(1, 640 / sw);
        tmp.width = Math.round(sw * k); tmp.height = Math.round(sh * k);
        tx.drawImage(img, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
        src = tmp; ox = sx; oy = sy; w = sw; h = sh;
      }
      const res = det.detect(src);
      for (const d of res.detections || []) {
        const kp = d.keypoints; if (!kp || kp.length < 4) continue;
        const P = i => ({ x: ox + kp[i].x * w, y: oy + kp[i].y * h });
        const size = d.boundingBox ? d.boundingBox.width * (w / (src.width || w)) : 0;
        const score = (d.categories && d.categories[0] ? d.categories[0].score : 0.5) * (1 + size / m);
        if (!best || score > best.score) {
          const [a, b] = [P(0), P(1)].sort((p, q) => p.x - q.x);
          best = { score, eyeL: a, eyeR: b, mouth: P(3) };
        }
      }
      if (best && best.score > 0.8) break; // good, confident hit
    }
    return best;
  } catch (e) {
    console.warn('face detection unavailable', e);
    return null;
  }
}
// least-squares similarity transform (scale+rotation+translation) mapping src pts -> dst pts
function fitSimilarity(src, dst, wts) {
  let W = 0, sx = 0, sy = 0, dx = 0, dy = 0;
  src.forEach((p, i) => { const w = wts[i]; W += w; sx += p.x * w; sy += p.y * w; dx += dst[i].x * w; dy += dst[i].y * w; });
  sx /= W; sy /= W; dx /= W; dy /= W;
  let a = 0, b = 0, n = 0;
  src.forEach((p, i) => {
    const w = wts[i], qx = p.x - sx, qy = p.y - sy, tx = dst[i].x - dx, ty = dst[i].y - dy;
    a += w * (qx * tx + qy * ty); b += w * (qx * ty - qy * tx); n += w * (qx * qx + qy * qy);
  });
  a /= n; b /= n;
  return { scale: Math.hypot(a, b), rot: Math.atan2(b, a), tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}
function applyAlignment(img, f) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const c = ES / 2;
  // image points relative to the picture centre (how drawSource places the image)
  const rel = p => ({ x: p.x - iw / 2, y: p.y - ih / 2 });
  const dst = [
    { x: c - 0.32 * ER, y: c - 0.1 * ER }, { x: c + 0.32 * ER, y: c - 0.1 * ER }, { x: c, y: c + 0.45 * ER },
  ];
  const T = fitSimilarity([rel(f.eyeL), rel(f.eyeR), rel(f.mouth)], dst, [1, 1, 0.7]);
  const base = 2 * ER / Math.min(iw, ih);
  ed.zoom = clamp(T.scale / base, ZMIN, ZMAX);
  ed.rot = clamp(T.rot, -Math.PI / 4, Math.PI / 4);
  // recompute translation so the eye midpoint still lands on target after clamping
  const s = base * ed.zoom, cos = Math.cos(ed.rot), sin = Math.sin(ed.rot);
  const em = rel({ x: (f.eyeL.x + f.eyeR.x) / 2, y: (f.eyeL.y + f.eyeR.y) / 2 });
  const mm = rel(f.mouth);
  const anchor = { x: em.x * 0.6 + mm.x * 0.4, y: em.y * 0.6 + mm.y * 0.4 };
  const target = { x: c, y: (c - 0.1 * ER) * 0.6 + (c + 0.45 * ER) * 0.4 };
  ed.ox = target.x - (cos * anchor.x - sin * anchor.y) * s - c;
  ed.oy = target.y - (sin * anchor.x + cos * anchor.y) * s - c;
  $('#zoom').value = ed.zoom; $('#rotate').value = Math.round(ed.rot * 180 / Math.PI);
}
const setAlignStatus = (t, cls) => { const el = $('#align-status'); el.textContent = t; el.className = cls || ''; };
let loadSeq = 0;
function loadFile(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const img = new Image();
  const seq = ++loadSeq;
  img.onload = async () => {
    ed.img = img; ed.zoom = 1; ed.rot = 0; ed.ox = 0; ed.oy = 0;
    $('#zoom').value = 1; $('#rotate').value = 0;
    drawEditor();
    setAlignStatus('🔍 自動對齊臉部中…', 'busy');
    const f = await detectFace(img);
    if (seq !== loadSeq) return;
    if (f) {
      applyAlignment(img, f); drawEditor();
      setAlignStatus('✅ 已自動對齊,不準的話可以手動微調', 'ok');
    } else {
      setAlignStatus('⚠️ 找不到臉,請手動把眼睛和嘴巴對準虛線', 'warn');
    }
  };
  img.onerror = () => alert('這張圖片讀不出來,換一張試試看。');
  img.src = URL.createObjectURL(file);
}
$('#file').addEventListener('change', e => loadFile(e.target.files[0]));
const card = $('#setup .card');
card.addEventListener('dragover', e => e.preventDefault());
card.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
$('#start').addEventListener('click', startGame);
$('#again').addEventListener('click', startGame);
$('#change').addEventListener('click', openSetup);
$('#btn-change').addEventListener('click', openSetup);
$('#btn-voice').addEventListener('click', e => {
  voiceOn = !voiceOn;
  e.currentTarget.textContent = voiceOn ? '🔊 求饒語音:開' : '🔇 求饒語音:關';
  if (!voiceOn && hasTTS) speechSynthesis.cancel();
});

// keyboard
// arrows (right hand) move / jump / crouch; attacks live on the left side of the keyboard
const KEYMAP = { KeyA: 'slap', KeyS: 'punch', KeyD: 'kick', KeyF: 'throw', KeyG: 'chain', Space: 'chain', KeyZ: 'slap', KeyX: 'punch', KeyC: 'kick', KeyV: 'throw', KeyB: 'chain' };
const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
addEventListener('keydown', e => {
  // end screen: Enter jumps straight into the next round
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && $('#end').classList.contains('show')) {
    e.preventDefault();
    if (!e.repeat) startGame();
    return;
  }
  if (e.target instanceof HTMLInputElement) return;
  if (DIRS[e.code]) {
    e.preventDefault();
    held[DIRS[e.code]] = true;
    if (e.code === 'ArrowUp' && !e.repeat) jump();
  } else if (KEYMAP[e.code]) {
    e.preventDefault();
    if (!e.repeat) press(KEYMAP[e.code]);
  }
});
addEventListener('keyup', e => {
  if (DIRS[e.code]) held[DIRS[e.code]] = false;
});
addEventListener('blur', () => { held.left = held.right = held.up = held.down = false; });

// touch buttons
document.querySelectorAll('[data-btn]').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('pressed'); press(b.dataset.btn); });
  const up = () => b.classList.remove('pressed');
  b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
document.querySelectorAll('[data-hold]').forEach(b => {
  const k = b.dataset.hold;
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); held[k] = true; if (k === 'up') jump(); b.classList.add('pressed'); });
  const up = () => { held[k] = false; b.classList.remove('pressed'); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
});

// boot
resetGame();
finalizeFace();
drawEditor();
requestAnimationFrame(frame);
// debug/testing hook
window.__fighter = { G, P, O, press, startGame };
})();
