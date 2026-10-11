// 가구·설비 3D 모델 (치수 기반 파라메트릭 생성)
// 모든 빌더는 바닥 중심을 원점으로, 정면이 +z 를 향하는 THREE.Group 을 만든다. 단위 m.
import * as THREE from 'three';
import { getTexture } from './textures.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
const CYL_LO = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const SPH = new THREE.IcosahedronGeometry(0.5, 1);
const TORUS = new THREE.TorusGeometry(0.5, 0.06, 10, 40);
// 여러 모델이 함께 쓰는 단위 도형 — 장면을 다시 만들 때 dispose 하지 않음
for (const g of [BOX, CYL, CYL_LO, SPH, TORUS]) g.userData.shared = true;

const mats = new Map();
/** 재질 캐시. o: { r: roughness, m: metalness, e: emissive, ei, opacity, map } */
export function mat(color, o = {}) {
  const key = color + '|' + (o.r ?? '') + '|' + (o.m ?? '') + '|' + (o.e ?? '') + '|' + (o.ei ?? '') + '|' + (o.opacity ?? '') + '|' + (o.map ? o.map.uuid : '');
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.r ?? 0.75,
      metalness: o.m ?? 0,
      emissive: o.e ?? '#000000',
      emissiveIntensity: o.ei ?? 1,
      transparent: o.opacity != null,
      opacity: o.opacity ?? 1,
      depthWrite: o.opacity == null,
      map: o.map ?? null,
    });
    mats.set(key, m);
  }
  return m;
}

export function shade(hex, dl) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + dl)));
  return '#' + c.getHexString();
}

export function mix(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function add(g, geo, m, sx, sy, sz, x, y, z) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}
/** 상자: (x, z) 중심, y0 = 아래면 높이 */
const box = (g, m, w, h, d, x, y0, z) => add(g, BOX, m, w, h, d, x, y0 + h / 2, z);
/** 세운 원기둥 */
const cyl = (g, m, r, h, x, y0, z, geo = CYL) => add(g, geo, m, r * 2, h, r * 2, x, y0 + h / 2, z);
/** 앞면(+z) 이음선 */
const seamMat = () => mat('#2a2826', { r: 0.9, opacity: 0.55 });
const handleMat = () => mat('#a9adb1', { r: 0.35, m: 0.7 });

// ─────────────────────────────── 침실
function bed({ w, d, h, color }) {
  const g = new THREE.Group();
  const legH = 0.06, baseH = 0.26, top = legH + baseH;
  box(g, mat(color), w, baseH, d, 0, legH, 0);
  const leg = mat('#3a3029', { r: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, leg, 0.05, legH, 0.05, sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07));
  const mattW = w - 0.08, mattD = d - 0.16, mattH = 0.2;
  box(g, mat('#f4f2ee', { r: 0.95 }), mattW, mattH, mattD, 0, top, 0.04);
  box(g, mat(shade(color, -0.05)), w, Math.max(h, top + mattH + 0.1), 0.08, 0, 0, -d / 2 + 0.04);
  const n = w >= 1.3 ? 2 : 1;
  const pw = Math.min(0.62, mattW / n - 0.1);
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i ? 1 : -1) * (mattW / 4);
    box(g, mat('#ffffff', { r: 0.95 }), pw, 0.11, 0.36, x, top + mattH, -d / 2 + 0.36);
  }
  const duvD = mattD * 0.62;
  box(g, mat(mix(color, '#ffffff', 0.7), { r: 0.95 }), mattW + 0.04, 0.08, duvD, 0, top + mattH - 0.04, d / 2 - 0.035 - duvD / 2);
  return g;
}

function drawers({ w, d, h, color }, { rows = 3 } = {}) {
  const g = new THREE.Group();
  const plinth = 0.05;
  box(g, mat(shade(color, -0.12)), w - 0.04, plinth, d - 0.04, 0, 0, -0.01);
  box(g, mat(color), w, h - plinth, d, 0, plinth, 0);
  const rowH = (h - plinth) / rows;
  for (let i = 0; i < rows; i++) {
    if (i) box(g, seamMat(), w - 0.02, 0.006, 0.004, 0, plinth + i * rowH, d / 2 + 0.002);
    box(g, handleMat(), Math.min(0.16, w * 0.3), 0.014, 0.016, 0, plinth + (i + 0.5) * rowH, d / 2 + 0.008);
  }
  return g;
}

function wardrobe({ w, d, h, color }, { doors } = {}) {
  const g = new THREE.Group();
  const n = doors || Math.max(1, Math.round(w / 0.5));
  const plinth = 0.06;
  box(g, mat(shade(color, -0.15)), w - 0.04, plinth, d - 0.04, 0, 0, -0.01);
  box(g, mat(color), w, h - plinth, d, 0, plinth, 0);
  const dw = w / n;
  for (let i = 1; i < n; i++) box(g, seamMat(), 0.006, h - plinth - 0.02, 0.004, -w / 2 + i * dw, plinth + 0.01, d / 2 + 0.002);
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1; // 문 두 짝씩 가운데 손잡이
    const x = -w / 2 + (i + 0.5) * dw + side * (dw / 2 - 0.05);
    box(g, handleMat(), 0.014, Math.min(0.3, h * 0.2), 0.018, n === 1 ? w / 2 - 0.06 : x, Math.min(1.0, h * 0.45), d / 2 + 0.009);
  }
  return g;
}

function vanity({ w, d, h, color }) {
  const g = new THREE.Group();
  const top = 0.75;
  const m = mat(color);
  box(g, m, w, 0.03, d, 0, top - 0.03, 0);
  box(g, m, w - 0.06, 0.12, d - 0.04, 0, top - 0.15, -0.01);
  box(g, handleMat(), 0.12, 0.012, 0.015, 0, top - 0.09, d / 2 - 0.02);
  const leg = mat(shade(color, -0.1));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, leg, 0.035, top - 0.15, 0.035, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04));
  const mh = Math.max(0.3, h - top - 0.02), mw = Math.min(w * 0.7, 0.6);
  box(g, m, mw, mh, 0.025, 0, top, -d / 2 + 0.04);
  box(g, mat('#cfdbe3', { r: 0.08, m: 0.4 }), mw - 0.05, mh - 0.05, 0.004, 0, top + 0.025, -d / 2 + 0.055);
  return g;
}

function mirror({ w, d, h, color }) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const tilt = Math.atan2(Math.max(0.05, d - 0.06), h);
  box(inner, mat(color, { r: 0.5 }), w, h, 0.03, 0, -h / 2, 0);
  box(inner, mat('#d6e1e8', { r: 0.06, m: 0.45 }), w - 0.06, h - 0.06, 0.004, 0, -h / 2 + 0.03, 0.017);
  inner.rotation.x = -tilt;
  inner.position.set(0, h / 2 * Math.cos(tilt), 0);
  g.add(inner);
  return g;
}

function hanger({ w, d, h, color }) {
  const g = new THREE.Group();
  const metal = mat(color, { r: 0.35, m: 0.6 });
  for (const sx of [-1, 1]) {
    cyl(g, metal, 0.013, h, sx * (w / 2 - 0.02), 0, 0, CYL_LO);
    box(g, metal, 0.04, 0.03, d, sx * (w / 2 - 0.02), 0, 0);
  }
  box(g, metal, w, 0.025, 0.025, 0, h - 0.04, 0);
  const pal = ['#2f3e5c', '#d8c6a8', '#8a8f94', '#f4f2ee', '#7b4b32', '#8fa58a', '#45494d', '#d7a7a2'];
  const r = rng(Math.round(w * 100));
  const k = Math.max(2, Math.floor((w - 0.2) / 0.075));
  for (let i = 0; i < k; i++) {
    if (r() < 0.25) continue;
    const len = 0.55 + r() * 0.4;
    box(g, mat(pal[Math.floor(r() * pal.length)], { r: 0.95 }), 0.025, len, Math.min(0.44, d - 0.02), -w / 2 + 0.1 + i * 0.075, h - 0.06 - len, 0);
  }
  return g;
}

// ─────────────────────────────── 거실
function sofa({ w, d, h, color }, { chaise = false } = {}) {
  const g = new THREE.Group();
  const fab = mat(color, { r: 0.95 });
  const cush = mat(shade(color, 0.04), { r: 0.95 });
  const leg = mat('#2d2a27', { r: 0.5 });
  const legH = 0.08, baseH = 0.24, backT = 0.2;
  const armW = Math.min(0.18, w * 0.11);
  const mainD = chaise ? Math.min(0.95, d) : d;
  const z0 = -d / 2;
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) for (const z of [z0 + 0.06, d / 2 - 0.06]) cyl(g, leg, 0.022, legH, x, 0, z, CYL_LO);
  box(g, fab, w, baseH, mainD, 0, legH, z0 + mainD / 2);
  const armH = 0.62 - legH;
  box(g, fab, armW, armH, mainD, -w / 2 + armW / 2, legH, z0 + mainD / 2);
  const rightArm = !chaise;
  if (rightArm) box(g, fab, armW, armH, mainD, w / 2 - armW / 2, legH, z0 + mainD / 2);
  const innerL = -w / 2 + armW, innerR = rightArm ? w / 2 - armW : w / 2;
  const innerW = innerR - innerL;
  box(g, fab, innerW, Math.max(0.3, h - legH), backT, (innerL + innerR) / 2, legH, z0 + backT / 2);
  const n = innerW > 1.6 ? 3 : innerW > 0.95 ? 2 : 1;
  const cw = innerW / n;
  const seatD = mainD - backT - 0.02;
  for (let i = 0; i < n; i++) {
    const x = innerL + (i + 0.5) * cw;
    box(g, cush, cw - 0.012, 0.14, seatD, x, legH + baseH, z0 + backT + seatD / 2 + 0.01);
    box(g, cush, cw - 0.03, Math.min(0.38, h - 0.46), 0.14, x, legH + baseH + 0.14, z0 + backT + 0.07);
  }
  if (chaise && d > mainD + 0.05) {
    const chW = Math.min(0.95, w * 0.42), chD = d - mainD;
    const x = w / 2 - chW / 2;
    box(g, fab, chW, baseH, chD, x, legH, z0 + mainD + chD / 2);
    box(g, cush, chW - 0.012, 0.14, chD + seatD - 0.01, x, legH + baseH + 0.001, d / 2 - (chD + seatD) / 2 - 0.005);
  }
  return g;
}

function tv({ w, d, h, color }, { wall = false } = {}) {
  const g = new THREE.Group();
  const standH = wall ? 0 : 0.07;
  const ph = Math.max(0.1, h - standH), pt = 0.045;
  const pz = wall ? -d / 2 + pt / 2 : 0;
  const bezel = mat(color, { r: 0.4, m: 0.3 });
  box(g, bezel, w, ph, pt, 0, standH, pz);
  box(g, mat('#0c1118', { r: 0.12, m: 0.2, e: '#0d1d30', ei: 0.5 }), w - 0.025, ph - 0.025, 0.004, 0, standH + 0.0125, pz + pt / 2 + 0.002);
  if (!wall) {
    box(g, bezel, Math.min(0.5, w * 0.36), 0.02, Math.max(0.12, d * 0.9), 0, 0, 0);
    box(g, bezel, 0.08, standH, 0.04, 0, 0.02, -0.01);
  }
  return g;
}

function lowCabinet({ w, d, h, color }, { doors = 2 } = {}) {
  const g = new THREE.Group();
  const legH = Math.min(0.08, h * 0.12);
  const leg = mat('#3a3633', { r: 0.5 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, leg, 0.018, legH, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), CYL_LO);
  box(g, mat(color), w, h - legH, d, 0, legH, 0);
  const dw = w / doors;
  for (let i = 1; i < doors; i++) box(g, seamMat(), 0.006, h - legH - 0.03, 0.004, -w / 2 + i * dw, legH + 0.015, d / 2 + 0.002);
  for (let i = 0; i < doors; i++) box(g, handleMat(), Math.min(0.12, dw * 0.4), 0.012, 0.015, -w / 2 + (i + 0.5) * dw, h - 0.07, d / 2 + 0.008);
  return g;
}

function legs4(g, m, w, d, h, inset = 0.05, t = 0.045) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, m, t, h, t, sx * (w / 2 - inset), 0, sz * (d / 2 - inset));
}

function coffeeTable({ w, d, h, color }) {
  const g = new THREE.Group();
  const m = mat(color, { r: 0.6 });
  box(g, m, w, 0.04, d, 0, h - 0.04, 0);
  box(g, m, w - 0.08, 0.02, d - 0.08, 0, 0.1, 0);
  legs4(g, mat(shade(color, -0.2)), w, d, h - 0.04, 0.04, 0.04);
  return g;
}

function roundSide({ w, d, h, color }) {
  const g = new THREE.Group();
  const m = mat(color, { r: 0.55 });
  const r = Math.min(w, d) / 2;
  add(g, CYL, m, w, 0.025, d, 0, h - 0.0125, 0);
  cyl(g, mat('#2f2f2f', { r: 0.4, m: 0.5 }), 0.02, h - 0.025, 0, 0, 0, CYL_LO);
  cyl(g, mat('#2f2f2f', { r: 0.4, m: 0.5 }), r * 0.6, 0.015, 0, 0, 0);
  return g;
}

function rug({ w, d, h, color }) {
  const g = new THREE.Group();
  const t = Math.max(0.006, h);
  const m = mat(color, { r: 1 });
  const border = mat(shade(color, -0.1), { r: 1 });
  const b = box(g, border, w, t, d, 0, 0, 0);
  const i = box(g, m, Math.max(0.05, w - 0.12), t + 0.001, Math.max(0.05, d - 0.12), 0, 0, 0);
  b.castShadow = i.castShadow = false;
  return g;
}

function floorLamp({ w, d, h, color }) {
  const g = new THREE.Group();
  const metal = mat('#2b2b2b', { r: 0.4, m: 0.6 });
  const r = Math.min(w, d) / 2;
  cyl(g, metal, r * 0.7, 0.025, 0, 0, 0);
  cyl(g, metal, 0.012, h - 0.25, 0, 0.025, 0, CYL_LO);
  const shadeGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.95, 0.3, 28, 1, true);
  const lampShade = add(g, shadeGeo, mat(color, { r: 0.9, e: '#ffe2b0', ei: 0.35 }), 1, 1, 1, 0, h - 0.15, 0);
  lampShade.material.side = THREE.DoubleSide;
  add(g, SPH, mat('#fff4dc', { e: '#ffe6b8', ei: 1 }), 0.08, 0.08, 0.08, 0, h - 0.2, 0);
  return g;
}

// ─────────────────────────────── 식탁·의자·책상
function table({ w, d, h, color }) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.6 }), w, 0.035, d, 0, h - 0.035, 0);
  box(g, mat(shade(color, -0.05)), w - 0.14, 0.07, d - 0.14, 0, h - 0.105, 0);
  legs4(g, mat(shade(color, -0.12)), w, d, h - 0.035, 0.07, 0.055);
  return g;
}

function roundTable({ w, d, h, color }) {
  const g = new THREE.Group();
  add(g, CYL, mat(color, { r: 0.55 }), w, 0.035, d, 0, h - 0.0175, 0);
  const base = mat(shade(color, -0.25), { r: 0.5 });
  cyl(g, base, 0.05, h - 0.035, 0, 0, 0);
  cyl(g, base, Math.min(w, d) * 0.25, 0.03, 0, 0, 0);
  return g;
}

function chair({ w, d, h, color }) {
  const g = new THREE.Group();
  const seatH = 0.45;
  const m = mat(color, { r: 0.7 });
  const leg = mat(shade(color, -0.15));
  const t = 0.032;
  for (const sx of [-1, 1]) {
    box(g, leg, t, seatH - 0.03, t, sx * (w / 2 - 0.035), 0, d / 2 - 0.04);
    box(g, leg, t, h, t, sx * (w / 2 - 0.035), 0, -d / 2 + 0.035);
  }
  box(g, m, w, 0.04, d - 0.02, 0, seatH - 0.04, 0.01);
  box(g, m, w - 0.02, 0.2, 0.025, 0, h - 0.24, -d / 2 + 0.035);
  return g;
}

function stool({ w, d, h, color }) {
  const g = new THREE.Group();
  add(g, CYL, mat(color, { r: 0.6 }), w, 0.04, d, 0, h - 0.02, 0);
  legs4(g, mat(shade(color, -0.15)), w * 0.85, d * 0.85, h - 0.04, 0.04, 0.03);
  return g;
}

function desk({ w, d, h, color }) {
  const g = new THREE.Group();
  const m = mat(color, { r: 0.6 });
  const frame = mat(shade(color, -0.35), { r: 0.45, m: 0.3 });
  box(g, m, w, 0.03, d, 0, h - 0.03, 0);
  for (const sx of [-1, 1]) {
    box(g, frame, 0.04, h - 0.03, 0.04, sx * (w / 2 - 0.05), 0, d / 2 - 0.06);
    box(g, frame, 0.04, h - 0.03, 0.04, sx * (w / 2 - 0.05), 0, -d / 2 + 0.06);
    box(g, frame, 0.04, 0.03, d - 0.08, sx * (w / 2 - 0.05), 0, 0);
  }
  box(g, frame, w - 0.14, 0.05, 0.02, 0, h - 0.09, -d / 2 + 0.06);
  return g;
}

function lowTable({ w, d, h, color }) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.6 }), w, 0.03, d, 0, h - 0.03, 0);
  box(g, mat(shade(color, -0.06)), w - 0.1, 0.05, d - 0.1, 0, h - 0.08, 0);
  legs4(g, mat(shade(color, -0.12)), w, d, h - 0.03, 0.06, 0.045);
  return g;
}

function officeChair({ w, d, h, color }) {
  const g = new THREE.Group();
  const dark = mat('#26282b', { r: 0.5, m: 0.3 });
  const m = mat(color, { r: 0.85 });
  const R = Math.min(w, d) / 2 - 0.03;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = box(g, dark, 0.04, 0.03, R, Math.sin(a) * R / 2, 0.05, Math.cos(a) * R / 2);
    arm.rotation.y = a;
    add(g, SPH, dark, 0.05, 0.05, 0.05, Math.sin(a) * R, 0.025, Math.cos(a) * R);
  }
  cyl(g, dark, 0.025, 0.36, 0, 0.08, 0, CYL_LO);
  box(g, m, w * 0.78, 0.08, d * 0.72, 0, 0.44, 0.02);
  const back = box(g, m, w * 0.72, Math.max(0.3, h - 0.58), 0.06, 0, 0.58, -d * 0.32);
  back.rotation.x = -0.1;
  box(g, dark, 0.05, 0.12, 0.05, 0, 0.5, -d * 0.3);
  for (const sx of [-1, 1]) {
    box(g, dark, 0.03, 0.2, 0.03, sx * w * 0.38, 0.5, 0.02);
    box(g, dark, 0.06, 0.025, 0.24, sx * w * 0.38, 0.7, 0.04);
  }
  return g;
}

function bookshelf({ w, d, h, color }) {
  const g = new THREE.Group();
  const m = mat(color);
  const t = 0.02;
  for (const sx of [-1, 1]) box(g, m, t, h, d, sx * (w / 2 - t / 2), 0, 0);
  box(g, m, w, t, d, 0, h - t, 0);
  box(g, m, w, 0.06, d, 0, 0, 0);
  box(g, mat(shade(color, -0.06)), w - 2 * t, h - 0.08, 0.008, 0, 0.06, -d / 2 + 0.004);
  const n = Math.max(2, Math.round((h - 0.08) / 0.36));
  const sp = (h - 0.06 - t) / n;
  const pal = ['#2f3e5c', '#b5483b', '#d1a53a', '#4f6d5a', '#efe6d4', '#7b4b32', '#5b6770', '#c47a4a'];
  const r = rng(Math.round(w * 1000 + h * 10));
  for (let i = 0; i < n; i++) {
    const y = 0.06 + i * sp;
    if (i) box(g, m, w - 2 * t, t, d - 0.01, 0, y - t, 0.005);
    let x = -w / 2 + t + 0.01;
    const maxX = w / 2 - t - 0.01;
    while (x < maxX - 0.03) {
      if (r() < 0.12) { x += 0.06 + r() * 0.08; continue; }
      const bw = 0.018 + r() * 0.03;
      if (x + bw > maxX) break;
      const bh = Math.min(sp - t - 0.03, 0.17 + r() * 0.12);
      box(g, mat(pal[Math.floor(r() * pal.length)], { r: 0.85 }), bw, bh, d * 0.72, x + bw / 2, y, 0.01);
      x += bw + 0.002;
    }
  }
  return g;
}

function monitor({ w, d, h, color }) {
  const g = new THREE.Group();
  const m = mat(color, { r: 0.4, m: 0.3 });
  const ph = Math.max(0.15, h - 0.1);
  box(g, m, w, ph, 0.025, 0, h - ph, -0.01);
  box(g, mat('#0c1118', { r: 0.12, e: '#0d1d30', ei: 0.5 }), w - 0.015, ph - 0.015, 0.003, 0, h - ph + 0.0075, 0.004);
  box(g, m, 0.04, h - ph + 0.05, 0.03, 0, 0.01, -0.04);
  box(g, m, Math.min(0.25, w * 0.4), 0.012, Math.max(0.1, d * 0.8), 0, 0, -0.01);
  return g;
}

// ─────────────────────────────── 가전
function fridge({ w, d, h, color }) {
  const g = new THREE.Group();
  const body = mat(color, { r: 0.32, m: 0.35 });
  box(g, body, w, h - 0.02, d, 0, 0.02, 0);
  box(g, mat('#2f3134'), w - 0.04, 0.05, 0.01, 0, 0.01, d / 2 - 0.02);
  if (w >= 0.85) {
    box(g, seamMat(), 0.006, h - 0.04, 0.004, 0, 0.03, d / 2 + 0.002);
    for (const sx of [-1, 1]) box(g, handleMat(), 0.02, 0.7, 0.03, sx * 0.04, h * 0.42, d / 2 + 0.015);
  } else {
    box(g, seamMat(), w - 0.01, 0.006, 0.004, 0, h * 0.38, d / 2 + 0.002);
    box(g, handleMat(), 0.02, 0.5, 0.03, w / 2 - 0.06, h * 0.5, d / 2 + 0.015);
    box(g, handleMat(), 0.02, 0.3, 0.03, w / 2 - 0.06, h * 0.12, d / 2 + 0.015);
  }
  return g;
}

function kimchi({ w, d, h, color }) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.32, m: 0.3 }), w, h - 0.02, d, 0, 0.02, 0);
  const cuts = [0.3, 0.55, 0.78];
  for (const c of cuts) box(g, seamMat(), w - 0.01, 0.006, 0.004, 0, h * c, d / 2 + 0.002);
  for (const c of [0.27, 0.52, 0.75]) box(g, handleMat(), w * 0.5, 0.02, 0.03, 0, h * c, d / 2 + 0.015);
  box(g, seamMat(), 0.006, h * (1 - 0.78) - 0.03, 0.004, 0, h * 0.78, d / 2 + 0.002);
  return g;
}

function washer({ w, d, h, color }, { dryer = false } = {}) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.35, m: 0.1 }), w, h, d, 0, 0, 0);
  box(g, mat('#3a3d42', { r: 0.4 }), w - 0.03, 0.09, 0.006, 0, h - 0.12, d / 2 + 0.003);
  const r = Math.min(w, h) * 0.3;
  const cy = h * 0.43;
  const ring = add(g, TORUS, mat('#9aa0a6', { r: 0.3, m: 0.6 }), r * 2, r * 2, r * 2, 0, cy, d / 2 + 0.01);
  ring.castShadow = false;
  const glass = add(g, CYL, mat(dryer ? '#5b6168' : '#1e2a36', { r: 0.1, m: 0.3 }), r * 1.8, 0.01, r * 1.8, 0, cy, d / 2 + 0.005);
  glass.rotation.x = Math.PI / 2;
  return g;
}

function microwave({ w, d, h, color }) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.35, m: 0.3 }), w, h, d, 0, 0, 0);
  box(g, mat('#101317', { r: 0.1 }), w * 0.62, h * 0.7, 0.006, -w * 0.12, h * 0.15, d / 2 + 0.003);
  box(g, mat('#5e636a', { r: 0.4 }), w * 0.18, h * 0.7, 0.006, w * 0.34, h * 0.15, d / 2 + 0.003);
  return g;
}

function acStand({ w, d, h, color }) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.35 }), w, h, d, 0, 0, 0);
  const grille = mat('#b9bdc1', { r: 0.5 });
  for (let i = 0; i < 7; i++) box(g, grille, w * 0.7, 0.008, 0.004, 0, h * 0.55 + i * 0.05, d / 2 + 0.002);
  box(g, mat('#1d2125', { e: '#3fa7ff', ei: 0.4 }), 0.08, 0.03, 0.004, 0, h * 0.48, d / 2 + 0.002);
  return g;
}

function acWall({ w, d, h, color }) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.35 }), w, h, d, 0, 0, 0);
  box(g, mat('#3b3f44', { r: 0.6 }), w * 0.85, 0.035, 0.004, 0, h * 0.12, d / 2 + 0.002);
  return g;
}

function purifier({ w, d, h, color }) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.4 }), w, h, d, 0, 0, 0);
  add(g, CYL, mat('#7e858c', { r: 0.6 }), w * 0.7, 0.006, d * 0.7, 0, h + 0.001, 0);
  box(g, mat('#cfd3d6', { r: 0.6 }), w * 0.75, h * 0.55, 0.004, 0, h * 0.12, d / 2 + 0.002);
  return g;
}

// ─────────────────────────────── 소품·기타
function plant({ w, d, h, color }) {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const potH = Math.min(0.4, h * 0.32);
  const pot = new THREE.CylinderGeometry(r * 0.75, r * 0.58, potH, 24);
  add(g, pot, mat(color, { r: 0.8 }), 1, 1, 1, 0, potH / 2, 0);
  cyl(g, mat('#4a3a2c', { r: 1 }), r * 0.7, 0.01, 0, potH - 0.02, 0);
  cyl(g, mat('#5a4632'), 0.015, h * 0.5, 0, potH, 0, CYL_LO);
  const leaf = [mat('#3f7d3a', { r: 0.8 }), mat('#5c9a4c', { r: 0.8 }), mat('#2f6a33', { r: 0.8 })];
  const rr = rng(Math.round(h * 100));
  const top = h - potH;
  for (let i = 0; i < 9; i++) {
    const a = rr() * Math.PI * 2, rad = rr() * r * 0.7;
    const s = r * (0.55 + rr() * 0.5);
    const y = potH + top * (0.35 + rr() * 0.55);
    add(g, SPH, leaf[i % 3], s, s * 0.9, s, Math.cos(a) * rad, Math.min(h - s * 0.45, y), Math.sin(a) * rad);
  }
  return g;
}

function plainBox({ w, d, h, color }) {
  const g = new THREE.Group();
  box(g, mat(color, { r: 0.7 }), w, h, d, 0, 0, 0);
  box(g, mat(shade(color, -0.12)), w + 0.002, 0.01, d + 0.002, 0, h - 0.01, 0);
  return g;
}

// ─────────────────────────────── 고정 설비 (도면)
function counter({ w, d, h }) {
  const g = new THREE.Group();
  box(g, mat('#c9c4bb'), w, 0.1, d - 0.06, 0, 0, -0.03);
  box(g, mat('#eeebe5', { r: 0.6 }), w, h - 0.13, d - 0.02, 0, 0.1, -0.01);
  const n = Math.max(1, Math.round(w / 0.45));
  for (let i = 1; i < n; i++) box(g, seamMat(), 0.005, h - 0.16, 0.004, -w / 2 + (i * w) / n, 0.11, d / 2 - 0.0);
  box(g, seamMat(), w - 0.01, 0.005, 0.004, 0, h - 0.22, d / 2);
  const stone = getTexture('stone');
  const top = box(g, mat('#ffffff', { r: 0.45, map: stone.map }), w, 0.03, d, 0, h - 0.03, 0);
  top.castShadow = true;
  return g;
}

function sink({ w, d, h }) {
  const g = new THREE.Group();
  const steel = mat('#b8bec4', { r: 0.25, m: 0.75 });
  box(g, mat('#6f767d', { r: 0.3, m: 0.6 }), w * 0.82, 0.004, d * 0.62, 0, h + 0.0005, 0.02);
  cyl(g, steel, 0.02, 0.28, 0, h, -d / 2 + 0.07, CYL_LO);
  box(g, steel, 0.025, 0.025, 0.2, 0, h + 0.26, -d / 2 + 0.16);
  return g;
}

function cooktop({ w, d, h }) {
  const g = new THREE.Group();
  box(g, mat('#141518', { r: 0.15, m: 0.2 }), w * 0.9, 0.006, d * 0.85, 0, h, 0);
  const ring = mat('#4a4f55', { r: 0.4 });
  for (const [x, z] of [[-0.12, -0.1], [0.12, -0.1], [0, 0.12]]) {
    const t = add(g, TORUS, ring, 0.16, 0.16, 0.16, x * w * 2, h + 0.008, z * d * 2);
    t.rotation.x = Math.PI / 2;
    t.castShadow = false;
  }
  return g;
}

function toilet({ w, d }) {
  const g = new THREE.Group();
  const white = mat('#f7f7f5', { r: 0.2 });
  box(g, white, w * 0.95, 0.4, 0.18, 0, 0.38, -d / 2 + 0.09);
  add(g, CYL, white, w * 0.85, 0.4, d - 0.22, 0, 0.2, -d / 2 + 0.2 + (d - 0.22) / 2);
  add(g, CYL, mat('#ececea', { r: 0.3 }), w * 0.9, 0.03, d - 0.2, 0, 0.415, -d / 2 + 0.19 + (d - 0.2) / 2);
  return g;
}

function basin({ w, d }) {
  const g = new THREE.Group();
  box(g, mat('#e9e6e0', { r: 0.5 }), w, 0.45, d * 0.9, 0, 0.32, -d * 0.05);
  box(g, mat('#f8f8f6', { r: 0.2 }), w, 0.08, d, 0, 0.78, 0);
  box(g, mat('#d9dcde', { r: 0.2 }), w * 0.6, 0.004, d * 0.55, 0, 0.861, 0.03);
  cyl(g, mat('#b8bec4', { r: 0.25, m: 0.8 }), 0.015, 0.16, 0, 0.86, -d / 2 + 0.06, CYL_LO);
  box(g, mat('#d6e1e8', { r: 0.06, m: 0.45 }), w * 0.9, 0.7, 0.015, 0, 1.1, -d / 2 + 0.008);
  return g;
}

function shower({ w, d, h }) {
  const g = new THREE.Group();
  const tray = box(g, mat('#c6cacd', { r: 0.6 }), w, 0.03, d, 0, 0, 0);
  tray.castShadow = false;
  const glass = box(g, mat('#bcd7e6', { r: 0.05, opacity: 0.28 }), w * 0.6, h - 0.1, 0.01, -w * 0.2, 0.05, d / 2 - 0.01);
  glass.castShadow = false;
  box(g, mat('#9aa3aa', { r: 0.3, m: 0.6 }), 0.02, h - 0.1, 0.02, w * 0.1, 0.05, d / 2 - 0.01);
  const steel = mat('#b8bec4', { r: 0.25, m: 0.8 });
  cyl(g, steel, 0.012, 1.95, 0, 0, -d / 2 + 0.04, CYL_LO);
  add(g, CYL, steel, 0.2, 0.02, 0.2, 0, 1.95, -d / 2 + 0.12);
  cyl(g, mat('#555b60'), 0.04, 0.005, 0, 0.03, 0.1, CYL_LO);
  return g;
}

/** 계단: 앞면(+z)이 첫 단, 뒤쪽(−z)으로 올라감. 아래는 막힌 형태. */
function stairs({ w, d, h }, { steps = 12, rail = null } = {}) {
  const g = new THREE.Group();
  const run = d / steps, rise = h / steps;
  const white = mat('#f1efea', { r: 0.7 });
  const tread = mat('#d4b080', { r: 0.6 });
  const mats6 = [white, white, tread, white, white, white];
  for (let i = 0; i < steps; i++) {
    const hh = (i + 1) * rise;
    const m = new THREE.Mesh(BOX, mats6);
    m.scale.set(w, hh, run);
    m.position.set(0, hh / 2, d / 2 - (i + 0.5) * run);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  if (rail) {
    const x = rail === 'left' ? -w / 2 + 0.03 : w / 2 - 0.03;
    const rm = mat('#3b3d40', { r: 0.4, m: 0.6 });
    const pts = [];
    for (let i = 0; i < steps; i += 2) {
      const z = d / 2 - (i + 0.5) * run, y = (i + 1) * rise;
      box(g, rm, 0.025, 0.9, 0.025, x, y, z);
      pts.push([z, y + 0.9]);
    }
    const [z0, y0] = pts[0], [z1, y1] = pts[pts.length - 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const railMesh = add(g, BOX, rm, 0.04, 0.04, len, x, (y0 + y1) / 2, (z0 + z1) / 2);
    railMesh.rotation.x = Math.atan2(y1 - y0, -(z1 - z0));
  }
  return g;
}

export const BUILDERS = {
  bed, drawers, wardrobe, vanity, mirror, hanger,
  sofa, sofaL: (s) => sofa(s, { chaise: true }), tv, tvWall: (s) => tv(s, { wall: true }),
  lowCabinet, coffeeTable, roundSide, rug, floorLamp,
  table, roundTable, chair, stool, desk, lowTable, officeChair, bookshelf, monitor,
  fridge, kimchi, washer, microwave, acStand, acWall, purifier,
  plant, box: plainBox,
  // 설비
  cabinet: (s) => wardrobe(s, { doors: Math.max(2, Math.round(s.w / 0.45)) }),
  closet: (s) => wardrobe(s, { doors: Math.max(2, Math.round(s.w / 0.6)) }),
  counter, sink, cooktop, toilet, basin, shower, stairs,
};

/**
 * 치수(m)와 색으로 모델 생성.
 * spec: { builder, w, d, h, color, opts }
 */
export function buildModel(spec) {
  const fn = BUILDERS[spec.builder] || plainBox;
  const g = fn({ w: spec.w, d: spec.d, h: spec.h, color: spec.color || '#cccccc' }, spec.opts || {});
  return g;
}
