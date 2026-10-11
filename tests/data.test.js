import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, CATEGORIES, VARIANTS, SWATCHES, CATALOG_BY_TYPE } from '../src/catalog.js';
import {
  createItem, sanitizeItem, sanitizeState, defaultState, loadState, saveState, exportJson, importJson,
  exampleItems, STORAGE_KEY,
} from '../src/store.js';
import { scaledPlan, doorSwingRect, BASE, WALLS, DOORS, FIXTURES, PLAN_INFO } from '../src/planData.js';
import { makeObb, obbFromRect, obbOverlap, pointInRect } from '../src/geom2d.js';
import { readFileSync } from 'node:fs';

// models.js 의 BUILDERS 객체 키 (three.js 를 불러오지 않고 소스에서 추출)
const modelsSrc = readFileSync(new URL('../src/models.js', import.meta.url), 'utf8');
const buildersBlock = modelsSrc.slice(modelsSrc.indexOf('export const BUILDERS = {'), modelsSrc.indexOf('};', modelsSrc.indexOf('export const BUILDERS = {')));
const BUILDER_NAMES = new Set([...buildersBlock.matchAll(/([A-Za-z]+)\s*(?=[:,\n])/g)].map((m) => m[1]));

test('카탈로그: 요청된 가구 종류가 모두 있다', () => {
  const names = CATALOG.map((c) => c.name).join(' ');
  for (const must of ['소파', 'TV', '슈퍼싱글', '퀸', '킹', '라지킹', '식탁', '책상', '좌식 테이블']) {
    assert.ok(names.includes(must), `${must} 없음`);
  }
});

test('카탈로그: 항목 형식', () => {
  const catIds = new Set(CATEGORIES.map((c) => c.id));
  const types = new Set();
  for (const c of CATALOG) {
    assert.ok(!types.has(c.type), `중복 type ${c.type}`);
    types.add(c.type);
    assert.ok(catIds.has(c.cat), `${c.type} 분류 없음`);
    assert.ok(BUILDER_NAMES.has(c.builder), `${c.type} builder ${c.builder} 없음`);
    assert.equal(c.size.length, 3);
    for (const v of c.size) assert.ok(v > 0 && v <= 400);
    assert.match(c.color, /^#[0-9a-f]{6}$/);
    if (c.variants) assert.ok(VARIANTS[c.variants], `${c.type} variants 없음`);
  }
  for (const s of SWATCHES) assert.match(s.hex, /^#[0-9a-f]{6}$/);
});

test('침대 규격: 매트리스 폭 순서 싱글 < 슈퍼싱글 < 퀸 < 킹 < 라지킹', () => {
  const w = ['bed_single', 'bed_ss', 'bed_queen', 'bed_king', 'bed_lking'].map((t) => CATALOG_BY_TYPE[t].size[0]);
  for (let i = 1; i < w.length; i++) assert.ok(w[i] > w[i - 1]);
  assert.deepEqual(VARIANTS.bed.map((v) => v.label), ['싱글', '슈퍼싱글', '퀸', '킹', '라지킹']);
});

test('sanitizeItem: 잘못된 값 보정', () => {
  const it = sanitizeItem({ type: 'nope', w: -5, d: 'x', h: 9999, color: 'red', rot: -90, x: 1e9, name: '  ' });
  assert.equal(it.type, 'box');
  assert.equal(it.w, 1);
  assert.equal(it.d, CATALOG_BY_TYPE.box.size[1]);
  assert.equal(it.h, 400);
  assert.equal(it.color, CATALOG_BY_TYPE.box.color);
  assert.equal(it.rot, 270);
  assert.equal(it.x, 1500);
  assert.equal(it.name, CATALOG_BY_TYPE.box.name);
});

test('createItem: 카탈로그 기본값 + stackable 자동 높이', () => {
  const tv = createItem('tv');
  assert.equal(tv.elevAuto, true);
  const ac = createItem('acWall');
  assert.equal(ac.elev, 195);
  assert.equal(ac.elevAuto, false);
});

test('상태 저장·불러오기·내보내기 왕복', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const first = loadState(storage);
  assert.equal(first.firstRun, true);
  assert.equal(first.state.layouts.length, 3);
  first.state.layouts[1].items.push(createItem('sofa3', { x: 400, z: 500, rot: 90 }));
  first.state.plan.width = 6.5;
  assert.ok(saveState(storage, first.state));
  assert.ok(mem.has(STORAGE_KEY));
  const again = loadState(storage);
  assert.equal(again.firstRun, false);
  assert.equal(again.state.layouts[1].items[0].rot, 90);
  assert.equal(again.state.plan.width, 6.5);
  const imported = importJson(exportJson(again.state));
  assert.deepEqual(imported, again.state);
  assert.throws(() => importJson('not json'), /JSON/);
  assert.throws(() => importJson('{"a":1}'), /layouts/);
});

test('깨진 저장값이면 기본 상태', () => {
  const storage = { getItem: () => '{broken', setItem() {} };
  const s = loadState(storage);
  assert.equal(s.firstRun, true);
  assert.deepEqual(sanitizeState(null).plan, defaultState().plan);
});

test('도면: 문은 반드시 벽 위에 있고, 크기 보정은 비례', () => {
  for (const d of DOORS) {
    const onWall = WALLS.some((w) => {
      const [x1, z1, x2, z2] = w.r;
      const axis = x2 - x1 >= z2 - z1 ? 'x' : 'z';
      if (axis !== d.axis) return false;
      const [p1, p2] = axis === 'x' ? [z1, z2] : [x1, x2];
      const [a, b] = axis === 'x' ? [x1, x2] : [z1, z2];
      return d.at >= p1 && d.at <= p2 && d.from >= a - 1e-9 && d.to <= b + 1e-9;
    });
    assert.ok(onWall, `${d.name} 이 벽 위에 없음`);
  }
  const p = scaledPlan(BASE.width * 1.1, BASE.depth);
  assert.ok(Math.abs(p.walls[2].r[0] - WALLS[2].r[0] * 1.1) < 1e-9);
  const toilet0 = FIXTURES.find((f) => f.id === 'toilet');
  const toilet1 = p.fixtures.find((f) => f.id === 'toilet');
  assert.ok(Math.abs((toilet1.r[2] - toilet1.r[0]) - (toilet0.r[2] - toilet0.r[0])) < 1e-9, '변기 크기는 유지');
  assert.equal(PLAN_INFO.exclusiveArea, 50.16);
});

test('도면: 실내 면적 추정값이 전용면적과 비슷하다 (벽 중심선 기준 ±5%)', () => {
  const ext = 0.2 / 2;
  const area = (BASE.width + ext * 2) * (BASE.depth + ext * 2) + (6.36 - 5.35) * (7.9 - 7.38);
  assert.ok(Math.abs(area - PLAN_INFO.exclusiveArea) / PLAN_INFO.exclusiveArea < 0.05, `면적 ${area.toFixed(2)}㎡`);
});

test('예시 배치: 모든 가구가 집 안에 있고 벽·설비·문과 겹치지 않는다', () => {
  const p = scaledPlan();
  const blockers = [
    ...p.walls.map((w) => ({ name: '벽', obb: obbFromRect(w.r) })),
    ...p.fixtures.filter((f) => !f.decor).map((f) => ({ name: f.name, obb: obbFromRect(f.r) })),
    ...p.doors.map(doorSwingRect).filter(Boolean).map((r) => ({ name: '문', obb: obbFromRect(r) })),
  ];
  for (const it of exampleItems()) {
    const obb = makeObb(it.x / 100, it.z / 100, it.w / 100, it.d / 100, (it.rot * Math.PI) / 180);
    assert.ok(p.interior.some((r) => pointInRect(obb.cx, obb.cz, r)), `${it.name} 집 밖`);
    for (const b of blockers) assert.equal(obbOverlap(obb, b.obb), false, `${it.name} ↔ ${b.name}`);
  }
});
