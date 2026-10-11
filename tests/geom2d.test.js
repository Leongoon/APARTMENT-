import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeObb, obbFromRect, obbCorners, obbAabb, obbOverlap, pointInObb, isAxisAligned,
  snapToObstacles, measureClearances, rectToAabb, normDeg, verticalOverlap,
} from '../src/geom2d.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('회전 규약이 three.js rotation.y 와 같다 (90° 회전 시 로컬 +z 앞면이 월드 +x 를 향함)', () => {
  // 폭 2, 깊이 1 상자를 90° 돌리면 x 방향 길이가 1, z 방향 길이가 2
  const box = obbAabb(makeObb(0, 0, 2, 1, Math.PI / 2));
  close(box.maxX - box.minX, 1);
  close(box.maxZ - box.minZ, 2);
  // 로컬 (0, +d/2) 앞면 중점 → 월드 (+d/2, 0)
  const c = obbCorners(makeObb(0, 0, 2, 1, Math.PI / 2));
  const front = [(c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2];
  close(front[0], 0.5);
  close(front[1], 0);
});

test('맞닿은 두 상자는 겹침이 아니고, 파고들면 겹침', () => {
  const wall = obbFromRect([0, 0, 0.2, 3]);
  assert.equal(obbOverlap(makeObb(0.7, 1, 1, 1, 0), wall), false); // 벽 면에 딱 붙음
  assert.equal(obbOverlap(makeObb(0.65, 1, 1, 1, 0), wall), true);  // 5cm 파고듦
});

test('회전된 상자 겹침 판정 (SAT)', () => {
  const a = makeObb(0, 0, 2, 0.2, Math.PI / 4);
  assert.equal(obbOverlap(a, makeObb(0, 0, 0.2, 0.2, 0)), true);
  assert.equal(obbOverlap(a, makeObb(0.9, -0.9, 0.2, 0.2, 0)), false); // 대각선 막대 옆 빈 곳
});

test('pointInObb', () => {
  const o = makeObb(1, 1, 2, 1, Math.PI / 2);
  assert.equal(pointInObb(1.4, 1.9, o), true);
  assert.equal(pointInObb(1.9, 1.4, o), false);
});

test('isAxisAligned / normDeg / verticalOverlap', () => {
  assert.equal(isAxisAligned(0), true);
  assert.equal(isAxisAligned(Math.PI / 2 + 0.01), true);
  assert.equal(isAxisAligned(Math.PI / 4), false);
  assert.equal(normDeg(-15), 345);
  assert.equal(normDeg(725), 5);
  assert.equal(verticalOverlap(0, 0.45, 0.45, 1.2), false); // 거실장 위 TV
  assert.equal(verticalOverlap(0, 0.8, 0.5, 1.2), true);
});

test('벽 자석: 6cm 이내면 벽면에 붙도록 이동량 반환', () => {
  const wall = rectToAabb([0, 0, 0.2, 5]);
  const box = { minX: 0.25, maxX: 1.25, minZ: 1, maxZ: 2 };
  const { dx, dz } = snapToObstacles(box, [wall], 0.06);
  close(dx, -0.05);
  close(dz, 0);
  const far = snapToObstacles({ minX: 0.4, maxX: 1.4, minZ: 1, maxZ: 2 }, [wall], 0.06);
  assert.equal(far.dx, 0);
});

test('벽까지 거리 측정: 네 방향 가장 가까운 장애물', () => {
  const walls = [[-0.2, 0, 0, 4], [3, 0, 3.2, 4], [0, -0.2, 3, 0], [0, 4, 3, 4.2]].map(rectToAabb);
  const sofa = { minX: 0.5, maxX: 2.5, minZ: 1, maxZ: 2 };
  const c = measureClearances(sofa, walls);
  close(c.left.dist, 0.5);
  close(c.right.dist, 0.5);
  close(c.up.dist, 1);
  close(c.down.dist, 2);
  // 가운데 다른 가구가 있으면 그쪽이 더 가까움
  const table = rectToAabb([1, 2.6, 2, 3]);
  close(measureClearances(sofa, [...walls, table]).down.dist, 0.6);
});
