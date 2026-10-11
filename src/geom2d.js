// 바닥 평면(x, z) 위 2D 기하 계산 — 충돌 판정, 벽 자석, 벽까지 거리 측정.
// 회전 규약은 three.js 의 rotation.y 와 같다:
//   로컬 (lx, lz) → 월드 (cx + lx·cosθ + lz·sinθ,  cz − lx·sinθ + lz·cosθ)

const EPS = 1e-9;

/** 가구 같은 회전 사각형(OBB). angle 은 라디안. */
export function makeObb(cx, cz, w, d, angle = 0) {
  return { cx, cz, hw: w / 2, hd: d / 2, angle };
}

/** 축 정렬 사각형 [x1, z1, x2, z2] → OBB */
export function obbFromRect(r) {
  const [x1, z1, x2, z2] = r;
  return { cx: (x1 + x2) / 2, cz: (z1 + z2) / 2, hw: Math.abs(x2 - x1) / 2, hd: Math.abs(z2 - z1) / 2, angle: 0 };
}

function axes(o) {
  const c = Math.cos(o.angle), s = Math.sin(o.angle);
  // 로컬 x축, 로컬 z축의 월드 방향
  return [[c, -s], [s, c]];
}

export function obbCorners(o) {
  const [[ux, uz], [vx, vz]] = axes(o);
  const pts = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pts.push([o.cx + ux * o.hw * sx + vx * o.hd * sz, o.cz + uz * o.hw * sx + vz * o.hd * sz]);
  }
  return pts;
}

export function obbAabb(o) {
  const [[ux, uz], [vx, vz]] = axes(o);
  const ex = Math.abs(ux) * o.hw + Math.abs(vx) * o.hd;
  const ez = Math.abs(uz) * o.hw + Math.abs(vz) * o.hd;
  return { minX: o.cx - ex, maxX: o.cx + ex, minZ: o.cz - ez, maxZ: o.cz + ez };
}

/**
 * 분리축 정리(SAT)로 두 OBB 가 tol(미터) 이상 파고드는지 판정.
 * 맞닿기만 한 경우(벽에 딱 붙인 가구)는 겹침이 아니다.
 */
export function obbOverlap(a, b, tol = 0.005) {
  const aa = axes(a), bb = axes(b);
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const [ax, az] of [...aa, ...bb]) {
    const ra = a.hw * Math.abs(aa[0][0] * ax + aa[0][1] * az) + a.hd * Math.abs(aa[1][0] * ax + aa[1][1] * az);
    const rb = b.hw * Math.abs(bb[0][0] * ax + bb[0][1] * az) + b.hd * Math.abs(bb[1][0] * ax + bb[1][1] * az);
    const dist = Math.abs(dx * ax + dz * az);
    if (dist >= ra + rb - tol) return false;
  }
  return true;
}

/** 점이 OBB 안에 있는지 */
export function pointInObb(x, z, o) {
  const [[ux, uz], [vx, vz]] = axes(o);
  const dx = x - o.cx, dz = z - o.cz;
  return Math.abs(dx * ux + dz * uz) <= o.hw + EPS && Math.abs(dx * vx + dz * vz) <= o.hd + EPS;
}

export function pointInRect(x, z, r) {
  return x >= r[0] - EPS && x <= r[2] + EPS && z >= r[1] - EPS && z <= r[3] + EPS;
}

/** 각도가 90° 배수에 가까운지 (자석 스냅은 이때만 적용) */
export function isAxisAligned(angle, tolRad = 0.035) {
  const q = Math.PI / 2;
  const m = ((angle % q) + q) % q;
  return m < tolRad || q - m < tolRad;
}

/**
 * 벽 자석: 가구 외곽이 장애물 면에서 threshold 이내면 딱 붙도록 이동량(dx, dz)을 돌려준다.
 * box: 가구 AABB, obstacles: AABB 배열
 */
export function snapToObstacles(box, obstacles, threshold = 0.08) {
  let bestX = null, bestZ = null;
  for (const o of obstacles) {
    const zOverlap = Math.min(box.maxZ, o.maxZ) - Math.max(box.minZ, o.minZ);
    const xOverlap = Math.min(box.maxX, o.maxX) - Math.max(box.minX, o.minX);
    if (zOverlap > 0.02) {
      // 가구 왼쪽 면 ↔ 장애물 오른쪽 면
      const g1 = box.minX - o.maxX;
      if (Math.abs(g1) <= threshold && (bestX === null || Math.abs(g1) < Math.abs(bestX))) bestX = -g1;
      // 가구 오른쪽 면 ↔ 장애물 왼쪽 면
      const g2 = o.minX - box.maxX;
      if (Math.abs(g2) <= threshold && (bestX === null || Math.abs(g2) < Math.abs(bestX))) bestX = g2;
    }
    if (xOverlap > 0.02) {
      const g3 = box.minZ - o.maxZ;
      if (Math.abs(g3) <= threshold && (bestZ === null || Math.abs(g3) < Math.abs(bestZ))) bestZ = -g3;
      const g4 = o.minZ - box.maxZ;
      if (Math.abs(g4) <= threshold && (bestZ === null || Math.abs(g4) < Math.abs(bestZ))) bestZ = g4;
    }
  }
  return { dx: bestX ?? 0, dz: bestZ ?? 0 };
}

/**
 * 가구 AABB 의 네 방향(좌/우/위/아래)으로 가장 가까운 장애물까지의 거리.
 * 반환: { left, right, up, down } 각각 { dist, a:[x,z], b:[x,z] } 또는 null
 * up = −z 방향(도면 위쪽), down = +z 방향.
 */
export function measureClearances(box, obstacles, maxDist = 6) {
  const res = { left: null, right: null, up: null, down: null };
  const consider = (key, dist, a, b) => {
    if (dist < -0.001 || dist > maxDist) return;
    if (!res[key] || dist < res[key].dist) res[key] = { dist: Math.max(0, dist), a, b };
  };
  for (const o of obstacles) {
    const zLo = Math.max(box.minZ, o.minZ), zHi = Math.min(box.maxZ, o.maxZ);
    if (zHi - zLo > 0.01) {
      const zm = (zLo + zHi) / 2;
      if (o.minX >= box.maxX - 0.001) consider('right', o.minX - box.maxX, [box.maxX, zm], [o.minX, zm]);
      if (o.maxX <= box.minX + 0.001) consider('left', box.minX - o.maxX, [box.minX, zm], [o.maxX, zm]);
    }
    const xLo = Math.max(box.minX, o.minX), xHi = Math.min(box.maxX, o.maxX);
    if (xHi - xLo > 0.01) {
      const xm = (xLo + xHi) / 2;
      if (o.minZ >= box.maxZ - 0.001) consider('down', o.minZ - box.maxZ, [xm, box.maxZ], [xm, o.minZ]);
      if (o.maxZ <= box.minZ + 0.001) consider('up', box.minZ - o.maxZ, [xm, box.minZ], [xm, o.maxZ]);
    }
  }
  return res;
}

export function rectToAabb(r) {
  return { minX: Math.min(r[0], r[2]), maxX: Math.max(r[0], r[2]), minZ: Math.min(r[1], r[3]), maxZ: Math.max(r[1], r[3]) };
}

/** 각도(도)를 0~359 범위로 정규화 */
export function normDeg(deg) {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** 수직 구간 [a0, a1] 과 [b0, b1] 이 tol 이상 겹치는지 */
export function verticalOverlap(a0, a1, b0, b1, tol = 0.01) {
  return Math.min(a1, b1) - Math.max(a0, b0) > tol;
}
