// 이미지 파일 없이 캔버스로 그리는 바닥·상판 텍스처
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function toTexture(c, maxAniso) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso || 4;
  t.needsUpdate = true;
  return t;
}

const cache = new Map();

/**
 * 텍스처 1장이 덮는 실제 크기(m)를 함께 돌려준다: { map, tile }
 */
export function getTexture(name, maxAniso) {
  if (cache.has(name)) return cache.get(name);
  let out;
  switch (name) {
    case 'wood': out = { map: wood(maxAniso), tile: 1.6 }; break;
    case 'hex': out = { map: hex(maxAniso), tile: 0.6 }; break;
    case 'tile': out = { map: squareTile(maxAniso, '#55585c', '#3f4246', 4), tile: 1.2 }; break;
    case 'tile2': out = { map: squareTile(maxAniso, '#c9cbcc', '#a9acae', 4), tile: 1.2 }; break;
    case 'stone': out = { map: stone(maxAniso), tile: 0.8 }; break;
    default: throw new Error('unknown texture ' + name);
  }
  cache.set(name, out);
  return out;
}

// 1.6m × 1.6m, 폭 0.2m 강마루 8줄 (세로 방향)
function wood(aniso) {
  const size = 1024, [c, g] = canvas(size);
  const r = rng(7);
  const cols = 8, colW = size / cols;
  const base = [[201, 158, 112], [192, 148, 103], [208, 167, 121], [186, 142, 98], [198, 155, 108]];
  for (let i = 0; i < cols; i++) {
    let y = -r() * size;
    while (y < size) {
      const len = size * (0.55 + r() * 0.45);
      const [cr, cg, cb] = base[Math.floor(r() * base.length)];
      const j = (r() - 0.5) * 14;
      g.fillStyle = `rgb(${cr + j},${cg + j},${cb + j})`;
      g.fillRect(i * colW, y, colW, len);
      // 결 무늬
      g.globalAlpha = 0.18;
      for (let k = 0; k < 9; k++) {
        g.strokeStyle = r() > 0.5 ? '#7a5634' : '#e8c79c';
        g.lineWidth = 0.6 + r() * 1.4;
        const x0 = i * colW + r() * colW;
        g.beginPath();
        g.moveTo(x0, y);
        g.bezierCurveTo(x0 + (r() - 0.5) * 10, y + len * 0.33, x0 + (r() - 0.5) * 10, y + len * 0.66, x0 + (r() - 0.5) * 6, y + len);
        g.stroke();
      }
      g.globalAlpha = 1;
      // 마루 이음매
      g.fillStyle = 'rgba(90,60,35,0.55)';
      g.fillRect(i * colW, y, colW, 2);
      y += len;
    }
    g.fillStyle = 'rgba(90,60,35,0.5)';
    g.fillRect(i * colW, 0, 2, size);
  }
  return toTexture(c, aniso);
}

// 현관 육각 타일 (0.6m 반복)
function hex(aniso) {
  const size = 512, [c, g] = canvas(size);
  g.fillStyle = '#8f9396';
  g.fillRect(0, 0, size, size);
  const R = size / 6; // 육각 반지름
  const w = Math.sqrt(3) * R, vstep = 1.5 * R;
  const r = rng(3);
  for (let row = -1; row * vstep < size + R; row++) {
    for (let col = -1; col * w < size + w; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0);
      const cy = row * vstep;
      const v = 222 + Math.floor((r() - 0.5) * 16);
      g.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = cx + Math.cos(a) * (R - 3), py = cy + Math.sin(a) * (R - 3);
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
    }
  }
  return toTexture(c, aniso);
}

function squareTile(aniso, color, grout, n) {
  const size = 512, [c, g] = canvas(size);
  g.fillStyle = grout;
  g.fillRect(0, 0, size, size);
  const step = size / n, r = rng(11);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g.fillStyle = color;
      g.globalAlpha = 0.9 + r() * 0.1;
      g.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
    }
  }
  g.globalAlpha = 1;
  return toTexture(c, aniso);
}

// 주방 상판 인조대리석 느낌
function stone(aniso) {
  const size = 256, [c, g] = canvas(size);
  g.fillStyle = '#9a9ea3';
  g.fillRect(0, 0, size, size);
  const r = rng(5);
  for (let i = 0; i < 1600; i++) {
    const v = 120 + Math.floor(r() * 110);
    g.fillStyle = `rgba(${v},${v + 2},${v + 5},0.55)`;
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  return toTexture(c, aniso);
}

/** 바닥에 눕힐 글자 텍스처 (방 이름) */
export function textTexture(lines, { color = '#3b3a36', font = '600 64px sans-serif', sub = '500 40px sans-serif' } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  const w0 = g.measureText(lines[0]).width;
  g.font = sub;
  const w1 = lines[1] ? g.measureText(lines[1]).width : 0;
  c.width = Math.ceil(Math.max(w0, w1) + 24);
  c.height = lines[1] ? 128 : 84;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.font = font;
  g.fillText(lines[0], c.width / 2, 42);
  if (lines[1]) {
    g.font = sub;
    g.globalAlpha = 0.8;
    g.fillText(lines[1], c.width / 2, 100);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { map: t, aspect: c.width / c.height };
}
