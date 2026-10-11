// 평면도 데이터 → three.js 장면 (벽·문·바닥·설비·방 이름) + 충돌/측정용 장애물 목록
import * as THREE from 'three';
import { scaledPlan, doorSwingRect, DOOR_HEIGHT } from './planData.js';
import { buildModel, mat } from './models.js';
import { getTexture, textTexture } from './textures.js';
import { obbFromRect, rectToAabb } from './geom2d.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
BOX.userData.shared = true;
export const FACE_ROT = { '+z': 0, '+x': Math.PI / 2, '-x': -Math.PI / 2, '-z': Math.PI };
const UP_TO_FACE = { '-z': '+z', '+z': '-z', '-x': '+x', '+x': '-x' };

export const WALL_MODES = {
  full: { label: '벽 높게', height: (h) => h },
  half: { label: '벽 반높이', height: () => 1.1 },
  low: { label: '벽 낮게', height: () => 0.12 },
};

/** 앞면 방향에 따라 사각형을 (모델 가로 w, 깊이 d) 로 해석 */
export function rectDims(r, face) {
  const ex = r[2] - r[0], ez = r[3] - r[1];
  return face === '+x' || face === '-x' ? [ez, ex] : [ex, ez];
}

function wallMaterials() {
  const side = mat('#f2f0eb', { r: 0.92 });
  const top = mat('#2c2e30', { r: 0.85 });
  return [side, side, top, side, side, side];
}

function addBlock(group, mats, ax, az, bx, bz, y0, y1) {
  const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), z1 = Math.min(az, bz), z2 = Math.max(az, bz);
  const m = new THREE.Mesh(BOX, mats);
  m.scale.set(x2 - x1, y1 - y0, z2 - z1);
  m.position.set((x1 + x2) / 2, (y0 + y1) / 2, (z1 + z2) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/** 구간 [a, b] 에서 openings 를 빼고 남는 구간들 */
function subtractIntervals(a, b, openings) {
  let segs = [[a, b]];
  for (const [o1, o2] of openings) {
    const next = [];
    for (const [s1, s2] of segs) {
      if (o2 <= s1 || o1 >= s2) { next.push([s1, s2]); continue; }
      if (o1 > s1) next.push([s1, o1]);
      if (o2 < s2) next.push([o2, s2]);
    }
    segs = next;
  }
  return segs.filter(([s1, s2]) => s2 - s1 > 0.005);
}

function floorMesh(rect, texName, y, tint = '#ffffff') {
  const [x1, z1, x2, z2] = rect;
  const w = x2 - x1, d = z2 - z1, cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const { map, tile } = getTexture(texName);
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + cx) / tile, -(pos.getZ(i) + cz) / tile);
  const m = mat(tint, { r: 0.7, map });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(cx, y, cz);
  mesh.receiveShadow = true;
  return mesh;
}

function lineFrom(points, color, y) {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
}

function buildDoor(group, d, wallTop, showLeaf) {
  const width = d.to - d.from;
  const leafH = Math.min(2.05, wallTop);
  if (d.kind === 'entry') {
    const h = Math.min(2.08, wallTop);
    const slab = mat('#4f555b', { r: 0.5, m: 0.3 });
    if (d.axis === 'x') return addBlock(group, slab, d.from + 0.02, d.at - 0.03, d.to - 0.02, d.at + 0.03, 0, h);
    return addBlock(group, slab, d.at - 0.03, d.from + 0.02, d.at + 0.03, d.to - 0.02, 0, h);
  }
  if (d.kind === 'slide') {
    const h = Math.min(2.1, wallTop);
    const glass = mat('#bcd7e6', { r: 0.05, opacity: 0.3 });
    const frame = mat('#6c7277', { r: 0.4, m: 0.5 });
    const half = width * 0.55;
    for (const [s, off] of [[d.from, -0.02], [d.to - half, 0.02]]) {
      if (d.axis === 'x') {
        const g = addBlock(group, glass, s, d.at + off - 0.01, s + half, d.at + off + 0.01, 0.02, h - 0.02);
        g.castShadow = false;
        addBlock(group, frame, s, d.at + off - 0.015, s + 0.03, d.at + off + 0.015, 0, h);
        addBlock(group, frame, s + half - 0.03, d.at + off - 0.015, s + half, d.at + off + 0.015, 0, h);
      } else {
        const g = addBlock(group, glass, d.at + off - 0.01, s, d.at + off + 0.01, s + half, 0.02, h - 0.02);
        g.castShadow = false;
      }
    }
    return;
  }
  // 여닫이: 90° 열린 문짝 + 바닥 회전 반경 호
  const sgn = d.hinge === 'to' ? 1 : -1;
  const hingeAlong = d.hinge === 'to' ? d.to : d.from;
  const across = d.at + d.swing * d.wallT / 2;
  const hx = d.axis === 'x' ? hingeAlong : across;
  const hz = d.axis === 'x' ? across : hingeAlong;
  const openDir = d.axis === 'x' ? [0, d.swing] : [d.swing, 0];
  const closedDir = d.axis === 'x' ? [-sgn, 0] : [0, -sgn];
  if (showLeaf) {
    const leaf = mat('#efe7da', { r: 0.6 });
    const t = 0.036;
    if (d.axis === 'x') {
      const x = hx - sgn * (t / 2 + 0.005);
      addBlock(group, leaf, x - t / 2, hz, x + t / 2, hz + d.swing * (width - 0.02), 0.01, leafH);
    } else {
      const z = hz - sgn * (t / 2 + 0.005);
      addBlock(group, leaf, hx, z - t / 2, hx + d.swing * (width - 0.02), z + t / 2, 0.01, leafH);
    }
  }
  const a0 = Math.atan2(openDir[1], openDir[0]);
  const a1 = Math.atan2(closedDir[1], closedDir[0]);
  let diff = a1 - a0;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= 18; i++) {
    const a = a0 + (diff * i) / 18;
    pts.push([hx + Math.cos(a) * width, hz + Math.sin(a) * width]);
  }
  group.add(lineFrom(pts, '#8a9096', 0.012));
  group.add(lineFrom([[hx, hz], [hx + openDir[0] * width, hz + openDir[1] * width]], '#8a9096', 0.012));
}

/**
 * opts: { width, depth, wallHeight, wallMode, labels }
 * 반환: { root, plan, obstacles, surfaces, interior, bounds, center }
 */
export function buildPlan(opts) {
  const plan = scaledPlan(opts.width, opts.depth, opts.wallHeight);
  const wallTop = WALL_MODES[opts.wallMode || 'full'].height(plan.wallHeight);
  const root = new THREE.Group();
  root.name = 'plan';
  const obstacles = [];
  const surfaces = [];
  const cutMeshes = []; // 카메라 쪽에서 자동으로 낮출 외벽

  // 받침 슬래브
  const slabMat = mat('#3b3e41', { r: 0.9 });
  for (const r of plan.slabs) addBlock(root, slabMat, r[0], r[1], r[2], r[3], -0.16, -0.004).castShadow = false;

  // 바닥
  for (const r of plan.interior) root.add(floorMesh(r, 'wood', 0));
  for (const rm of plan.rooms) {
    if (!rm.floor) continue;
    const f = floorMesh(rm.r, rm.floor, 0.003);
    f.material = f.material.clone();
    f.material.userData.own = true;
    f.material.polygonOffset = true;
    f.material.polygonOffsetFactor = -1;
    root.add(f);
  }

  // 벽 (문 개구부를 잘라내고 상인방을 얹음)
  const wm = wallMaterials();
  for (const w of plan.walls) {
    const [x1, z1, x2, z2] = w.r;
    const axis = x2 - x1 >= z2 - z1 ? 'x' : 'z';
    const doors = w.kind === 'mass' ? [] : plan.doors.filter((d) => {
      if (d.axis !== axis) return false;
      const [p1, p2] = axis === 'x' ? [z1, z2] : [x1, x2];
      return d.at >= p1 - 0.001 && d.at <= p2 + 0.001;
    });
    const [a, b] = axis === 'x' ? [x1, x2] : [z1, z2];
    const segs = subtractIntervals(a, b, doors.map((d) => [d.from, d.to]));
    for (const [s1, s2] of segs) {
      const r = axis === 'x' ? [s1, z1, s2, z2] : [x1, s1, x2, s2];
      const m = addBlock(root, wm, r[0], r[1], r[2], r[3], 0, wallTop);
      if (w.n) cutMeshes.push({ mesh: m, n: w.n, type: 'wall', full: wallTop });
      obstacles.push({ kind: 'wall', rect: r, y0: -1, y1: 99 });
    }
    if (wallTop > DOOR_HEIGHT + 0.01) {
      for (const d of doors) {
        const from = Math.max(a, d.from), to = Math.min(b, d.to);
        const m = axis === 'x' ? addBlock(root, wm, from, z1, to, z2, DOOR_HEIGHT, wallTop) : addBlock(root, wm, x1, from, x2, to, DOOR_HEIGHT, wallTop);
        if (w.n) cutMeshes.push({ mesh: m, n: w.n, type: 'top' });
      }
    }
  }

  // 문
  for (const d of plan.doors) {
    const slab = buildDoor(root, d, wallTop, opts.wallMode === 'full');
    if (slab && d.kind === 'entry') cutMeshes.push({ mesh: slab, n: d.axis === 'x' ? [0, -1] : [-1, 0], type: 'wall', full: slab.scale.y });
    const swing = doorSwingRect(d);
    if (swing) obstacles.push({ kind: 'door', rect: swing, y0: 0, y1: 2.0, name: d.name });
    if (d.kind === 'entry') {
      // 현관문 앞은 신발 벗는 공간으로 비워 둠
      const r = d.axis === 'x' ? [d.from, d.at + d.wallT / 2, d.to, d.at + d.wallT / 2 + 0.6] : null;
      if (r) obstacles.push({ kind: 'door', rect: r, y0: 0, y1: 2.0, name: d.name });
    }
  }

  // 고정 설비
  for (const f of plan.fixtures) {
    const face = f.kind === 'stairs' || f.kind === 'steps' ? UP_TO_FACE[f.up] : f.face;
    const [w, d] = rectDims(f.r, face);
    const builder = f.kind === 'steps' ? 'stairs' : f.kind;
    const model = buildModel({
      builder, w, d, h: f.h, color: f.color,
      opts: { steps: f.steps, rail: f.rail || null },
    });
    model.position.set((f.r[0] + f.r[2]) / 2, 0, (f.r[1] + f.r[3]) / 2);
    model.rotation.y = FACE_ROT[face];
    model.userData.fixture = f.id;
    root.add(model);
    if (!f.decor) obstacles.push({ kind: 'fixture', rect: f.r, y0: 0, y1: f.h, name: f.name });
    if (f.surface) surfaces.push({ rect: f.r, top: f.h, name: f.name });
  }

  // 방 이름
  if (opts.labels !== false) {
    for (const rm of plan.rooms) {
      const w = rm.r[2] - rm.r[0], d = rm.r[3] - rm.r[1];
      const lines = [rm.name];
      if (rm.size) lines.push(`${w.toFixed(1)} × ${d.toFixed(1)} m`);
      const { map, aspect } = textTexture(lines);
      const lw = rm.small ? 0.75 : Math.min(1.1, w * 0.6);
      const geo = new THREE.PlaneGeometry(lw, lw / aspect);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.62, depthWrite: false }));
      m.material.userData.own = true;
      m.material.userData.ownMap = true;
      const [lx, lz] = rm.labelAt || [(rm.r[0] + rm.r[2]) / 2, (rm.r[1] + rm.r[3]) / 2];
      m.position.set(lx, 0.008, lz);
      m.renderOrder = 1;
      root.add(m);
    }
  }

  for (const o of obstacles) {
    o.obb = obbFromRect(o.rect);
    o.aabb = rectToAabb(o.rect);
  }
  for (const s of surfaces) s.obb = obbFromRect(s.rect);

  const xs = plan.slabs.flatMap((r) => [r[0], r[2]]), zs = plan.slabs.flatMap((r) => [r[1], r[3]]);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  return { root, plan, obstacles, surfaces, interior: plan.interior, bounds, center, wallTop, cutMeshes, cutaway: (opts.wallMode || 'full') === 'full' };
}

const CUT_HEIGHT = 0.12;
/**
 * 카메라를 향한 외벽을 낮춰 집 안이 보이게 한다 (위에서 거의 수직으로 볼 때는 그대로).
 * dir: 도면 중심 → 카메라 수평 방향(정규화), steep: 거의 위에서 내려다보는지
 */
export function applyCutaway(planBuild, dirX, dirZ, steep, enabled) {
  for (const c of planBuild.cutMeshes) {
    const cut = enabled && planBuild.cutaway && !steep && c.n[0] * dirX + c.n[1] * dirZ > 0.2;
    if (c.cut === cut) continue;
    c.cut = cut;
    if (c.type === 'top') {
      c.mesh.visible = !cut;
    } else {
      const h = cut ? Math.min(CUT_HEIGHT, c.full) : c.full;
      c.mesh.scale.y = h;
      c.mesh.position.y = h / 2;
    }
  }
}
