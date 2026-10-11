// 등촌동 복층 3D 가구 배치 시뮬레이터 — 앱 진입점
import * as THREE from 'three';
import { Viewer, disposeTree } from './viewer.js';
import { buildPlan, WALL_MODES } from './plan3d.js';
import { buildModel } from './models.js';
import { CATALOG, CATEGORIES, VARIANTS, SWATCHES, catalogItem } from './catalog.js';
import {
  loadState, saveState, createItem, sanitizeItem, exportJson, importJson, exampleItems, newId, LAYOUT_NAMES,
} from './store.js';
import {
  makeObb, obbAabb, obbOverlap, pointInObb, pointInRect, isAxisAligned, snapToObstacles,
  measureClearances, verticalOverlap, normDeg,
} from './geom2d.js';
import { thumbnail } from './thumbs.js';
import { icon } from './icons.js';
import { BASE, PLAN_INFO } from './planData.js';
import { Overlay, fmt } from './overlay.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deg2rad = THREE.MathUtils.degToRad;
const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
const bridge = window.AndroidBridge || null;
const storage = (() => { try { return window.localStorage; } catch { return null; } })();

const S = {
  data: null,
  firstRun: false,
  viewer: null,
  overlay: null,
  planBuild: null,
  objects: new Map(),
  mode: 'idle',          // idle | placing | eye
  viewTool: 'rotate',    // 한 손가락 드래그: rotate | pan
  dragTarget: 'item',    // 배치 중 한 손가락 드래그: item | view
  placing: null,
  drag: null,
  selectedId: null,
  sheet: null,
  lastDeleted: null,
};

// ───────────────────────────────────────── 저장
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(storage, S.data), 250);
}
const items = () => S.data.layouts[S.data.active].items;

// ───────────────────────────────────────── 가구 ↔ 3D
function itemObb(it) {
  return makeObb(it.x / 100, it.z / 100, it.w / 100, it.d / 100, deg2rad(it.rot));
}

function makeObject(it) {
  const def = catalogItem(it.type);
  const root = new THREE.Group();
  const model = buildModel({ builder: def.builder, w: it.w / 100, d: it.d / 100, h: it.h / 100, color: it.color, opts: def.opts });
  if (it.flip) model.scale.x = -1;
  root.add(model);
  root.userData.itemId = it.id;
  root.userData.key = modelKey(it);
  applyTransform(root, it);
  return root;
}
const modelKey = (it) => [it.type, it.w, it.d, it.h, it.color, it.flip].join('|');

function applyTransform(obj, it) {
  obj.position.set(it.x / 100, it.elev / 100, it.z / 100);
  obj.rotation.y = deg2rad(it.rot);
}

function syncObject(it) {
  let obj = S.objects.get(it.id);
  if (obj && obj.userData.key !== modelKey(it)) {
    removeObject(it.id);
    obj = null;
  }
  if (!obj) {
    obj = makeObject(it);
    S.viewer.furnitureGroup.add(obj);
    S.objects.set(it.id, obj);
  } else {
    applyTransform(obj, it);
  }
  S.viewer.requestRender();
}

function removeObject(id) {
  const obj = S.objects.get(id);
  if (!obj) return;
  S.viewer.furnitureGroup.remove(obj);
  disposeTree(obj);
  S.objects.delete(id);
  S.viewer.requestRender();
}

function rebuildAllObjects() {
  for (const id of [...S.objects.keys()]) removeObject(id);
  for (const it of items()) syncObject(it);
}

// ───────────────────────────────────────── 도면
function rebuildPlan() {
  const p = S.data.plan;
  S.planBuild = buildPlan({
    width: p.width, depth: p.depth, wallHeight: p.wallHeight,
    wallMode: S.mode === 'eye' ? 'full' : S.data.settings.wallMode,
    labels: S.data.settings.labels,
  });
  S.viewer.setPlan(S.planBuild);
  const estimated = Math.abs(p.width - BASE.width) < 1e-6 && Math.abs(p.depth - BASE.depth) < 1e-6;
  $('planSize').textContent = `${p.width.toFixed(2)} × ${p.depth.toFixed(2)} m${estimated ? ' (추정)' : ' (보정)'}`;
}

// ───────────────────────────────────────── 충돌 · 스냅 · 측정
const REASONS = [
  ['outside', () => '집 밖이에요'],
  ['wall', () => '벽과 겹쳐요'],
  ['fixture', (n) => `${n || '붙박이 설비'}와(과) 겹쳐요`],
  ['furniture', (n) => `${n || '다른 가구'}와(과) 겹쳐요`],
  ['door', (n) => `${n || '문'} 열리는 자리를 막아요`],
];

function evaluate(it, exclude = new Set([it.id])) {
  const def = catalogItem(it.type);
  const obb = itemObb(it);
  const y0 = it.elev / 100, y1 = (it.elev + it.h) / 100;
  const hits = new Map();
  if (!def.noCollide) {
    for (const o of S.planBuild.obstacles) {
      if (!verticalOverlap(y0, y1, o.y0, o.y1)) continue;
      if (obbOverlap(obb, o.obb) && !hits.has(o.kind)) hits.set(o.kind, o.name);
    }
    for (const other of items()) {
      if (exclude.has(other.id)) continue;
      const od = catalogItem(other.type);
      if (od.noCollide) continue;
      if ((def.kind === 'chair' && od.kind === 'table') || (def.kind === 'table' && od.kind === 'chair')) continue;
      if (!verticalOverlap(y0, y1, other.elev / 100, (other.elev + other.h) / 100)) continue;
      if (obbOverlap(obb, itemObb(other)) && !hits.has('furniture')) hits.set('furniture', other.name);
    }
  }
  if (!S.planBuild.interior.some((r) => pointInRect(obb.cx, obb.cz, r))) hits.set('outside', null);
  let message = null;
  for (const [k, fn] of REASONS) if (hits.has(k)) { message = fn(hits.get(k)); break; }
  return { ok: hits.size === 0, message, obb };
}

function otherAabbs(exclude, onlyVerticalWith) {
  const list = [];
  for (const o of items()) {
    if (exclude.has(o.id) || catalogItem(o.type).noCollide) continue;
    if (onlyVerticalWith && !verticalOverlap(onlyVerticalWith[0], onlyVerticalWith[1], o.elev / 100, (o.elev + o.h) / 100)) continue;
    list.push(obbAabb(itemObb(o)));
  }
  return list;
}

function clearancesFor(it, exclude) {
  const walls = S.planBuild.obstacles.filter((o) => o.kind !== 'door').map((o) => o.aabb);
  return measureClearances(obbAabb(itemObb(it)), walls.concat(otherAabbs(exclude)), 4);
}

/** 가구 중심 아래 가장 높은 받침면(cm) */
function supportTop(it, exclude) {
  const cx = it.x / 100, cz = it.z / 100;
  let top = 0;
  for (const s of S.planBuild.surfaces) if (pointInObb(cx, cz, s.obb)) top = Math.max(top, s.top * 100);
  for (const o of items()) {
    if (exclude.has(o.id) || !catalogItem(o.type).surface) continue;
    if (pointInObb(cx, cz, itemObb(o))) top = Math.max(top, o.elev + o.h);
  }
  return Math.round(top * 10) / 10;
}

function excludeSet() {
  const p = S.placing;
  const ex = new Set([p.item.id]);
  for (const r of p.riders) ex.add(r.item.id);
  return ex;
}

// ───────────────────────────────────────── 배치 모드
function centerFloorPoint() {
  const el = S.viewer.renderer.domElement;
  const r = el.getBoundingClientRect();
  return S.viewer.floorPoint(r.left + r.width / 2, r.top + r.height * 0.45);
}

function findFreeSpot(it) {
  const x0 = it.x, z0 = it.z;
  const isOk = () => {
    const ev = evaluate(it);
    return ev.ok;
  };
  if (isOk()) return;
  for (let ring = 1; ring <= 20; ring++) {
    const r = ring * 12;
    const steps = ring * 8;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      it.x = Math.round(x0 + Math.cos(a) * r);
      it.z = Math.round(z0 + Math.sin(a) * r);
      if (isOk()) return;
    }
  }
  it.x = x0;
  it.z = z0;
}

function startPlacement(it, isNew, { keepPosition = false } = {}) {
  closeSheet();
  if (S.mode === 'placing') cancelPlacement();
  S.selectedId = null;
  if (isNew && keepPosition) {
    findFreeSpot(it);
    if (it.elevAuto) it.elev = supportTop(it, new Set([it.id]));
  } else if (isNew) {
    const p = centerFloorPoint() || S.planBuild.center;
    const b = S.planBuild.bounds;
    it.x = Math.round(Math.min(b.maxX - 0.3, Math.max(b.minX + 0.3, p.x)) * 100);
    it.z = Math.round(Math.min(b.maxZ - 0.3, Math.max(b.minZ + 0.3, p.z)) * 100);
    const az = THREE.MathUtils.radToDeg(S.viewer.controls.getAzimuthalAngle());
    it.rot = normDeg(Math.round(az / 90) * 90);
    if (it.elevAuto) it.elev = supportTop(it, new Set([it.id]));
    findFreeSpot(it);
    if (it.elevAuto) it.elev = supportTop(it, new Set([it.id]));
  }
  const def = catalogItem(it.type);
  const riders = [];
  if (!isNew && def.surface) {
    const obb = itemObb(it);
    for (const o of items()) {
      if (o.id === it.id || !catalogItem(o.type).stackable) continue;
      if (Math.abs(o.elev - (it.elev + it.h)) < 1.5 && pointInObb(o.x / 100, o.z / 100, obb)) riders.push({ item: o, original: { ...o } });
    }
  }
  S.placing = { item: it, isNew, original: { ...it }, riders };
  S.mode = 'placing';
  S.dragTarget = 'item';
  syncObject(it);
  updateChrome();
  refreshPlacement();
  showHint(true);
}

function updateRiders() {
  const p = S.placing;
  if (!p || !p.riders.length) return;
  const o0 = p.original, it = p.item;
  const dRot = it.rot - o0.rot;
  const a = deg2rad(dRot), c = Math.cos(a), s = Math.sin(a);
  const dTop = (it.elev + it.h) - (o0.elev + o0.h);
  for (const r of p.riders) {
    const lx = r.original.x - o0.x, lz = r.original.z - o0.z;
    r.item.x = Math.round((it.x + lx * c + lz * s) * 10) / 10;
    r.item.z = Math.round((it.z - lx * s + lz * c) * 10) / 10;
    r.item.rot = normDeg(r.original.rot + dRot);
    r.item.elev = Math.max(0, r.original.elev + dTop);
    syncObject(r.item);
  }
}

function refreshPlacement() {
  const p = S.placing;
  if (!p) return;
  const it = p.item;
  const ev = evaluate(it, excludeSet());
  p.ok = ev.ok;
  const st = $('pbStatus');
  st.className = 'status ' + (ev.ok ? 'ok' : 'bad');
  st.innerHTML = ev.ok ? `${icon('check')}배치 가능` : `${icon('warn')}${esc(ev.message)}`;
  $('pbName').textContent = it.name;
  $('pbSize').textContent = `${fmt(it.w)}×${fmt(it.d)}×${fmt(it.h)}cm`;
  $('pbAngle').textContent = `${it.rot}°`;
  $('pbSlider').value = it.rot;
  $('pbConfirm').innerHTML = `${icon('check')}${ev.ok ? '결정' : '그래도 결정'}`;
  $('pbConfirm').classList.toggle('btn-warn', !ev.ok);
  $('pbConfirm').classList.toggle('btn-primary', ev.ok);
  $('pbMove').setAttribute('aria-checked', String(S.dragTarget === 'item'));
  $('pbView').setAttribute('aria-checked', String(S.dragTarget === 'view'));
  S.overlay.show(ev.obb, !ev.ok, S.data.settings.measure ? clearancesFor(it, excludeSet()) : null);
}

function moveItemTo(xcm, zcm) {
  const p = S.placing;
  if (!p) return;
  const it = p.item;
  const b = S.planBuild.bounds;
  it.x = Math.min(b.maxX * 100 + 50, Math.max(b.minX * 100 - 50, xcm));
  it.z = Math.min(b.maxZ * 100 + 50, Math.max(b.minZ * 100 - 50, zcm));
  if (S.data.settings.magnet && isAxisAligned(deg2rad(it.rot))) {
    const ex = excludeSet();
    const y = [it.elev / 100, (it.elev + it.h) / 100];
    const obs = S.planBuild.obstacles.filter((o) => o.kind !== 'door' && verticalOverlap(y[0], y[1], o.y0, o.y1)).map((o) => o.aabb)
      .concat(otherAabbs(ex, y));
    const { dx, dz } = snapToObstacles(obbAabb(itemObb(it)), obs, 0.06);
    it.x += dx * 100;
    it.z += dz * 100;
  }
  it.x = Math.round(it.x * 10) / 10;
  it.z = Math.round(it.z * 10) / 10;
  if (it.elevAuto) it.elev = supportTop(it, excludeSet());
  syncObject(it);
  updateRiders();
  refreshPlacement();
}

function rotateBy(d) {
  const p = S.placing;
  if (!p) return;
  setRotation(p.item.rot + d);
}

function setRotation(v) {
  const p = S.placing;
  if (!p) return;
  p.item.rot = normDeg(v);
  syncObject(p.item);
  moveItemTo(p.item.x, p.item.z);
}

function confirmPlacement() {
  const p = S.placing;
  if (!p) return;
  if (p.isNew) items().push(p.item);
  const ok = p.ok;
  S.placing = null;
  S.mode = 'idle';
  S.overlay.hide();
  save();
  updateChrome();
  showHint();
  toast(ok ? `${p.item.name} 배치 완료` : `${p.item.name}을(를) 겹친 상태로 배치했어요`);
}

function cancelPlacement() {
  const p = S.placing;
  if (!p) return;
  if (p.isNew) removeObject(p.item.id);
  else {
    Object.assign(p.item, p.original);
    syncObject(p.item);
  }
  for (const r of p.riders) {
    Object.assign(r.item, r.original);
    syncObject(r.item);
  }
  S.placing = null;
  S.mode = 'idle';
  S.overlay.hide();
  updateChrome();
  showHint();
}

// ───────────────────────────────────────── 선택
function select(id) {
  const it = items().find((i) => i.id === id);
  if (!it) return deselect();
  S.selectedId = id;
  $('selName').textContent = it.name;
  $('selSize').textContent = `${fmt(it.w)}×${fmt(it.d)}×${fmt(it.h)}cm · ${it.rot}°`;
  const ev = evaluate(it);
  S.overlay.show(ev.obb, !ev.ok, S.data.settings.measure ? clearancesFor(it, new Set([it.id])) : null);
  updateChrome();
}

function deselect() {
  S.selectedId = null;
  if (S.mode !== 'placing') S.overlay.hide();
  updateChrome();
}

function deleteItem(id) {
  const list = items();
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const [it] = list.splice(idx, 1);
  removeObject(id);
  S.lastDeleted = { it, idx, layout: S.data.active };
  if (S.selectedId === id) deselect();
  save();
  updateChrome();
  toast(`${it.name} 삭제`, { label: '되돌리기', fn: undoDelete });
}

function undoDelete() {
  const d = S.lastDeleted;
  if (!d) return;
  S.lastDeleted = null;
  S.data.layouts[d.layout].items.splice(d.idx, 0, d.it);
  if (d.layout === S.data.active) syncObject(d.it);
  save();
  updateChrome();
}

function duplicateItem(id) {
  const src = items().find((i) => i.id === id);
  if (!src) return;
  // 복제본은 새 가구처럼 [결정]을 눌러야 목록에 들어감
  const copy = sanitizeItem({ ...src, id: newId(), x: src.x + 30, z: src.z + 30 });
  startPlacement(copy, true, { keepPosition: true });
}

// ───────────────────────────────────────── 화면 구성 갱신
function updateChrome() {
  const placing = S.mode === 'placing';
  const eye = S.mode === 'eye';
  document.getElementById('app').classList.toggle('is-placing', placing);
  document.getElementById('app').classList.toggle('is-eye', eye);
  $('toolbar').hidden = placing || eye;
  $('placebar').hidden = !placing;
  $('rail').hidden = eye;
  $('eyebar').hidden = !eye;
  $('selbar').hidden = !(S.mode === 'idle' && S.selectedId);
  $('layoutTabs').style.visibility = placing || eye ? 'hidden' : 'visible';
  $('banner').hidden = !(S.mode === 'idle' && !S.selectedId && S.data.settings.exampleNotice && S.data.active === 0 && items().length > 0);
  $('toolRotate').setAttribute('aria-pressed', String(S.viewTool === 'rotate'));
  $('toolPan').setAttribute('aria-pressed', String(S.viewTool === 'pan'));
  const n = items().length;
  const badge = $('toolList').querySelector('.badge');
  badge.textContent = n;
  badge.hidden = n === 0;
  renderLayoutTabs();
  renderRail();
  updateControls();
}

function updateControls() {
  const c = S.viewer.controls;
  if (S.mode === 'eye') { c.enabled = false; return; }
  c.enabled = true;
  const itemDrag = S.mode === 'placing' && S.dragTarget === 'item';
  const pan = S.mode !== 'placing' && S.viewTool === 'pan';
  c.enableRotate = !itemDrag;
  c.touches.ONE = pan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  c.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  c.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  c.mouseButtons.RIGHT = THREE.MOUSE.PAN;
}

function renderLayoutTabs() {
  const el = $('layoutTabs');
  el.innerHTML = S.data.layouts.map((l, i) => {
    const letter = LAYOUT_NAMES[i].slice(-1);
    return `<button type="button" role="tab" aria-selected="${i === S.data.active}" data-layout="${i}" aria-label="${esc(l.name)}, 가구 ${l.items.length}개">${letter}<small class="num">${l.items.length}</small></button>`;
  }).join('');
}

function renderRail() {
  const v = S.viewer.view;
  const wm = S.data.settings.wallMode;
  $('btnView').innerHTML = `${icon(v === 'top' ? 'cube' : 'plan')}<span>${v === 'top' ? '3D 보기' : '평면 보기'}</span>`;
  $('btnWalls').innerHTML = `${icon('wall')}<span>${WALL_MODES[wm].label}</span>`;
  $('btnEye').innerHTML = `${icon('eye')}<span>1인칭</span>`;
  $('btnHome').innerHTML = `${icon('home')}<span>처음 시점</span>`;
}

let hintTimer = 0;
function showHint(force) {
  const el = $('hint');
  let text;
  if (S.mode === 'placing') {
    text = S.dragTarget === 'item' ? '끌어서 가구 이동 · 바닥을 탭하면 그 자리로' : '끌어서 시점 회전 · 가구는 그대로';
  } else if (S.mode === 'eye') {
    text = '';
  } else {
    text = S.viewTool === 'rotate' ? '끌어서 회전 · 두 손가락으로 확대 · 가구를 탭하면 선택' : '끌어서 화면 이동 · 두 손가락으로 확대';
  }
  el.textContent = text;
  el.hidden = !text;
  el.classList.remove('is-hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.add('is-hidden'), force ? 4500 : 3500);
}

// ───────────────────────────────────────── 토스트 · 모달 · 시트
let toastTimer = 0;
function toast(msg, action) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 2400);
}

function modal({ title, body, actions }) {
  return new Promise((resolve) => {
    $('modalTitle').textContent = title;
    const bodyEl = $('modalBody');
    bodyEl.innerHTML = '';
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.append(body);
    const act = $('modalActions');
    act.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.label;
      b.onclick = async () => {
        if (a.run) {
          const keep = await a.run();
          if (keep === true) return;
        }
        $('modal').hidden = true;
        resolve(a.value);
      };
      act.append(b);
    }
    $('modal').hidden = false;
    $('modal').dataset.cancel = '1';
    S.modalResolve = resolve;
  });
}

function closeModal() {
  if ($('modal').hidden) return false;
  $('modal').hidden = true;
  if (S.modalResolve) S.modalResolve(undefined);
  return true;
}

function confirmDialog(title, text, okLabel = '확인', danger = false) {
  return modal({
    title, body: `<p style="margin:0">${esc(text)}</p>`,
    actions: [{ label: '취소', value: false }, { label: okLabel, value: true, cls: danger ? 'btn-warn' : 'btn-primary' }],
  });
}

function openSheet(name, title, bodyHtml, footHtml) {
  S.sheet = name;
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = bodyHtml;
  $('sheetBody').scrollTop = 0;
  const foot = $('sheetFoot');
  foot.hidden = !footHtml;
  foot.innerHTML = footHtml || '';
  $('sheet').hidden = false;
  $('scrim').hidden = false;
}

function closeSheet() {
  if (!S.sheet) return false;
  const was = S.sheet;
  S.sheet = null;
  $('sheet').hidden = true;
  $('scrim').hidden = true;
  if (S.onSheetClose) {
    const fn = S.onSheetClose;
    S.onSheetClose = null;
    fn(was);
  }
  return true;
}

// ───────────────────────────────────────── 가구 추가(카탈로그)
let catalogState = { cat: 'all', q: '' };
const ALIASES = [[/티비|텔레비|tv/i, 'tv'], [/쇼파/, '소파'], [/책상|데스크/, '책상'], [/식탁|테이블/, '테이블']];

function catalogMatches(def, q) {
  if (!q) return true;
  const hay = `${def.name} ${def.note || ''} ${def.type} ${def.builder}`.toLowerCase();
  if (hay.includes(q.toLowerCase())) return true;
  for (const [re, word] of ALIASES) if (re.test(q) && hay.includes(word)) return true;
  if (/테이블/.test(q) && catalogItem(def.type).kind === 'table') return true;
  return false;
}

function openCatalog() {
  const chips = [{ id: 'all', name: '전체' }, ...CATEGORIES]
    .map((c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${catalogState.cat === c.id}">${esc(c.name)}</button>`).join('');
  openSheet('catalog', '가구 추가',
    `<label class="search">${icon('search')}<input id="cSearch" type="search" enterkeyhint="search" autocomplete="off" placeholder="가구 이름 검색 (예: 침대, TV, 책상)" value="${esc(catalogState.q)}"></label>
     <div class="cats" role="group" aria-label="분류">${chips}</div>
     <div id="cGrid" class="grid"></div>`);
  renderCatalogGrid();
  $('cSearch').addEventListener('input', (e) => { catalogState.q = e.target.value.trim(); renderCatalogGrid(); });
  $('sheetBody').querySelector('.cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    catalogState.cat = b.dataset.cat;
    for (const c of e.currentTarget.children) c.setAttribute('aria-pressed', String(c === b));
    renderCatalogGrid();
  });
}

let thumbQueue = [];
function renderCatalogGrid() {
  const grid = $('cGrid');
  if (!grid) return;
  const list = CATALOG.filter((d) => (catalogState.cat === 'all' || d.cat === catalogState.cat) && catalogMatches(d, catalogState.q));
  grid.innerHTML = list.length ? list.map((d) => `
    <button type="button" class="card" data-type="${d.type}">
      <span class="thumb"><img alt="" data-thumb="${d.type}"></span>
      <b>${esc(d.name)}</b>
      <span class="num">${d.size[0]}×${d.size[1]}×${d.size[2]}</span>
    </button>`).join('') : `<p class="empty">찾는 가구가 없어요. <b>직접 입력 (상자)</b>로 크기만 넣어 배치할 수 있어요.</p>`;
  grid.onclick = (e) => {
    const card = e.target.closest('[data-type]');
    if (!card) return;
    openProps(createItem(card.dataset.type), 'new');
  };
  thumbQueue = list.map((d) => d.type);
  pumpThumbs();
}

function defThumb(def, color) {
  return thumbnail(S.viewer.renderer, { builder: def.builder, w: def.size[0] / 100, d: def.size[1] / 100, h: def.size[2] / 100, color: color || def.color, opts: def.opts });
}

function pumpThumbs() {
  const t0 = performance.now();
  while (thumbQueue.length && performance.now() - t0 < 24) {
    const type = thumbQueue.shift();
    const img = document.querySelector(`img[data-thumb="${type}"]`);
    if (!img) continue;
    const url = defThumb(catalogItem(type));
    if (url) img.src = url;
  }
  if (thumbQueue.length) requestAnimationFrame(pumpThumbs);
}

// ───────────────────────────────────────── 색상 · 크기 입력
function stepper(id, label, value, min, max) {
  return `<label class="dim"><span>${label}</span><span class="stepper">
    <button type="button" data-step="-1" data-for="${id}" aria-label="${label} 1cm 줄이기">−</button>
    <input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="1" value="${fmt(value)}">
    <button type="button" data-step="1" data-for="${id}" aria-label="${label} 1cm 늘리기">+</button></span></label>`;
}

/**
 * mode: 'new'(카탈로그에서 고른 새 가구) | 'edit'(배치된 가구) | 'placing'(배치 중인 가구)
 */
function openProps(it, mode) {
  const def = catalogItem(it.type);
  const variants = def.variants ? VARIANTS[def.variants] : null;
  const live = mode !== 'new';
  const body = `<div class="props">
    <div class="preview"><div class="thumb"><img id="pvImg" alt="${esc(it.name)} 미리보기"></div>
      <div><b>${esc(def.name)}</b><p>${esc(def.note || '색상과 크기를 정한 뒤 배치하세요.')}</p></div></div>
    <div class="field"><label for="pName">이름</label><input id="pName" class="text-input" maxlength="40" value="${esc(it.name)}"></div>
    ${variants ? `<div class="field"><span class="field-label">규격</span><div class="chips" id="pVariants">${variants.map((v, i) => `<button type="button" class="chip" data-v="${i}">${esc(v.label)}</button>`).join('')}</div></div>` : ''}
    <div class="field"><span class="field-label">크기 (cm)</span>
      <div class="dims">${stepper('pW', '가로', it.w, 1, 1000)}${stepper('pD', '깊이', it.d, 1, 1000)}${stepper('pH', '높이', it.h, 1, 400)}</div>
      <span class="unit-note">가로는 정면에서 본 폭, 깊이는 앞뒤 길이예요.</span></div>
    <div class="field"><span class="field-label">색상</span>
      <div class="swatches" id="pSwatches">${SWATCHES.map((s) => `<button type="button" class="swatch" style="background:${s.hex}" data-hex="${s.hex}" title="${s.name}" aria-label="${s.name}"></button>`).join('')}</div>
      <label class="color-row"><input type="color" id="pColor" value="${it.color}"><span>직접 고르기</span><span class="num" id="pHex">${it.color}</span></label></div>
    <div class="field"><span class="field-label">설치 높이 (바닥에서 아래면까지)</span>
      <div class="dims">${stepper('pE', 'cm', it.elev, 0, 300)}</div>
      <span class="unit-note" id="pElevNote">${def.stackable ? (it.elevAuto ? '받침 가구 위에 자동으로 올라가요. 직접 바꾸면 그 높이로 고정돼요.' : '직접 정한 높이로 고정돼 있어요.') : '벽걸이 TV·에어컨처럼 띄울 때 사용해요.'}</span></div>
    <div class="toggle-row"><div><b>좌우 반전</b><small>L형 소파의 카우치 방향 등을 바꿔요</small></div>
      <label class="switch"><input type="checkbox" id="pFlip" ${it.flip ? 'checked' : ''} aria-label="좌우 반전"><span></span></label></div>
  </div>`;
  const foot = mode === 'new'
    ? `<button type="button" class="btn" id="pCancel">취소</button><button type="button" class="btn btn-primary" id="pPlace">${icon('move')}배치하기</button>`
    : `<button type="button" class="btn btn-primary" id="pDone" style="grid-column:1/-1">완료</button>`;
  openSheet('props', mode === 'new' ? '색상·크기 정하기' : '색상·크기 바꾸기', body, foot);

  const markSwatch = () => {
    for (const b of $('pSwatches').children) b.setAttribute('aria-pressed', String(b.dataset.hex === it.color));
    $('pColor').value = it.color;
    $('pHex').textContent = it.color;
  };
  let pvTimer = 0;
  const preview = () => {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => {
      const url = thumbnail(S.viewer.renderer, { builder: def.builder, w: it.w / 100, d: it.d / 100, h: it.h / 100, color: it.color, opts: def.opts, flip: it.flip }, 192);
      if (url && $('pvImg')) $('pvImg').src = url;
    }, 60);
  };
  const apply = () => {
    const clean = sanitizeItem(it);
    Object.assign(it, { ...clean, id: it.id, x: it.x, z: it.z });
    preview();
    if (live) {
      if (mode === 'placing') {
        syncObject(it);
        moveItemTo(it.x, it.z);
      } else {
        syncObject(it);
        save();
        select(it.id);
      }
    }
  };
  const readDims = () => {
    for (const [id, key] of [['pW', 'w'], ['pD', 'd'], ['pH', 'h']]) {
      const v = parseFloat($(id).value);
      if (Number.isFinite(v) && v > 0) it[key] = v;
    }
  };
  markSwatch();
  preview();

  $('pName').addEventListener('input', (e) => { it.name = e.target.value.trim() || def.name; if (live) { save(); if (mode === 'placing') refreshPlacement(); else select(it.id); } });
  for (const id of ['pW', 'pD', 'pH']) $(id).addEventListener('change', () => { readDims(); apply(); });
  $('pE').addEventListener('change', () => {
    const v = parseFloat($('pE').value);
    if (Number.isFinite(v)) { it.elev = Math.max(0, v); it.elevAuto = false; $('pElevNote').textContent = '직접 정한 높이로 고정돼 있어요.'; apply(); }
  });
  $('sheetBody').querySelector('.props').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const input = $(step.dataset.for);
      const v = (parseFloat(input.value) || 0) + Number(step.dataset.step);
      input.value = fmt(Math.max(Number(input.min), Math.min(Number(input.max), Math.round(v * 10) / 10)));
      input.dispatchEvent(new Event('change'));
      return;
    }
    const sw = e.target.closest('[data-hex]');
    if (sw) { it.color = sw.dataset.hex; markSwatch(); apply(); return; }
    const v = e.target.closest('[data-v]');
    if (v && variants) {
      const pre = variants[Number(v.dataset.v)];
      const autoNamed = variants.some((x) => x.name && x.name === it.name) || it.name === def.name;
      it.w = pre.size[0];
      it.d = pre.size[1];
      if (pre.size[2]) it.h = pre.size[2];
      if (pre.name && autoNamed) { it.name = pre.name; $('pName').value = pre.name; }
      $('pW').value = fmt(it.w); $('pD').value = fmt(it.d); $('pH').value = fmt(it.h);
      apply();
    }
  });
  $('pColor').addEventListener('input', (e) => { it.color = e.target.value.toLowerCase(); markSwatch(); apply(); });
  $('pFlip').addEventListener('change', (e) => { it.flip = e.target.checked; apply(); });
  if (mode === 'new') {
    $('pCancel').onclick = () => closeSheet();
    $('pPlace').onclick = () => { readDims(); Object.assign(it, sanitizeItem(it)); startPlacement(it, true); };
  } else {
    $('pDone').onclick = () => closeSheet();
  }
}

// ───────────────────────────────────────── 목록
function openList() {
  const list = items();
  const layout = S.data.layouts[S.data.active];
  const body = list.length ? `<div class="rows">${list.map((it) => `
    <div class="row">
      <span class="dot" style="background:${it.color}"></span>
      <button type="button" class="meta" data-sel="${it.id}"><b>${esc(it.name)}</b><span class="num">${fmt(it.w)}×${fmt(it.d)}×${fmt(it.h)}cm · ${it.rot}°</span></button>
      <div class="row-actions">
        <button type="button" class="icon-btn" data-edit="${it.id}" aria-label="${esc(it.name)} 색상·크기">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-del="${it.id}" aria-label="${esc(it.name)} 삭제">${icon('trash')}</button>
      </div>
    </div>`).join('')}</div>` : `<p class="empty">아직 배치한 가구가 없어요.<br>아래 <b>가구 배치</b>를 눌러 시작하세요.</p>`;
  openSheet('list', `${layout.name} · 가구 ${list.length}개`, body,
    list.length ? `<button type="button" class="btn" id="lClear">모두 지우기</button><button type="button" class="btn btn-primary" id="lAdd">${icon('plus')}가구 추가</button>`
      : `<button type="button" class="btn btn-primary" id="lAdd" style="grid-column:1/-1">${icon('plus')}가구 추가</button>`);
  $('sheetBody').onclick = (e) => {
    const sel = e.target.closest('[data-sel]');
    if (sel) {
      closeSheet();
      const it = items().find((i) => i.id === sel.dataset.sel);
      if (it) { select(it.id); S.viewer.focusOn(it.x / 100, it.z / 100, 6); }
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) { const it = items().find((i) => i.id === ed.dataset.edit); if (it) openProps(it, 'edit'); return; }
    const del = e.target.closest('[data-del]');
    if (del) { deleteItem(del.dataset.del); openList(); }
  };
  $('lAdd').onclick = () => openCatalog();
  if ($('lClear')) $('lClear').onclick = async () => {
    if (await confirmDialog('모두 지우기', `${layout.name}의 가구 ${items().length}개를 모두 지울까요?`, '모두 지우기', true)) {
      clearLayout();
      closeSheet();
    }
  };
}

function clearLayout() {
  S.data.layouts[S.data.active].items = [];
  rebuildAllObjects();
  deselect();
  save();
  updateChrome();
}

// ───────────────────────────────────────── 설정
function toggleRow(id, title, desc, on) {
  return `<div class="toggle-row"><div><b>${title}</b><small>${desc}</small></div>
    <label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} aria-label="${title}"><span></span></label></div>`;
}

function openSettings() {
  const p = S.data.plan, st = S.data.settings;
  const others = [0, 1, 2].filter((i) => i !== S.data.active);
  const body = `
  <div class="section">
    <h3>도면 크기 보정</h3>
    <p>원본 평면도에는 치수가 없어 전용면적 ${PLAN_INFO.exclusiveArea}㎡에 맞춰 크기를 추정했어요(실내 약 ${BASE.width} × ${BASE.depth} m). 줄자로 잰 실내 전체 가로(왼쪽 벽↔오른쪽 벽)와 세로(현관 쪽 벽↔거실 끝 벽)를 넣으면 도면 전체가 비례해서 맞춰져요.</p>
    <div class="calib">
      <label class="dim"><span>가로 (m)</span><input id="sW" class="text-input num" type="number" inputmode="decimal" step="0.01" min="3" max="20" value="${p.width}"></label>
      <label class="dim"><span>세로 (m)</span><input id="sD" class="text-input num" type="number" inputmode="decimal" step="0.01" min="3" max="20" value="${p.depth}"></label>
      <label class="dim"><span>천장고 (m)</span><input id="sH" class="text-input num" type="number" inputmode="decimal" step="0.01" min="2.1" max="4" value="${p.wallHeight}"></label>
    </div>
    <div class="btn-row"><button type="button" class="btn btn-primary" id="sApply">도면에 적용</button><button type="button" class="btn" id="sReset">추정값으로 되돌리기</button></div>
  </div>
  <div class="section">
    <h3>배치 도우미</h3>
    <div>
      ${toggleRow('tMagnet', '벽·가구에 붙이기', '가까이 가져가면 벽이나 다른 가구에 딱 붙어요 (0°·90° 방향일 때)', st.magnet)}
      ${toggleRow('tMeasure', '거리 표시', '선택한 가구에서 벽·가구까지 거리를 cm로 보여 줘요', st.measure)}
      ${toggleRow('tLabels', '방 이름 표시', '바닥에 방 이름과 크기를 적어 둬요', st.labels)}
      ${toggleRow('tShadows', '그림자', '끄면 오래된 기기에서 더 부드럽게 움직여요', st.shadows)}
    </div>
  </div>
  <div class="section">
    <h3>${esc(S.data.layouts[S.data.active].name)}</h3>
    <p>배치안 A·B·C는 각각 따로 저장돼요. 지금 배치를 다른 안으로 복사해 두고 비교해 보세요.</p>
    <div class="btn-row">
      ${others.map((i) => `<button type="button" class="btn" data-copy="${i}">${icon('copy')}${esc(LAYOUT_NAMES[i])}로 복사</button>`).join('')}
      <button type="button" class="btn" id="sExample">평면도 예시 가구 놓기</button>
      <button type="button" class="btn" id="sClear">${icon('trash')}비우기</button>
    </div>
  </div>
  <div class="section">
    <h3>저장 · 공유</h3>
    <p>배치는 이 기기에 자동 저장돼요. 다른 기기로 옮기거나 백업하려면 내보내기를 쓰세요.</p>
    <div class="btn-row">
      <button type="button" class="btn" id="sShot">${icon('camera')}화면 저장</button>
      <button type="button" class="btn" id="sExport">${icon('download')}내보내기</button>
      <button type="button" class="btn" id="sImport">${icon('upload')}불러오기</button>
    </div>
  </div>
  <div class="section">
    <h3>사용 방법</h3>
    <ol class="help">
      <li><b>회전</b>을 켜고 한 손가락으로 끌면 3D로 돌려 볼 수 있어요. 두 손가락으로 벌리면 확대, 함께 끌면 이동해요.</li>
      <li><b>가구 배치</b> → 가구 선택 → 색상·크기 입력 → <b>배치하기</b>.</li>
      <li>배치 중에는 끌어서 옮기고, −90°/−15°/+15°/+90° 버튼이나 슬라이더로 돌려요. <b>시점 회전</b>을 고르면 가구는 그대로 두고 화면만 돌아가요.</li>
      <li>마음에 들면 <b>결정</b>을 누르세요. 그 자리에 설치돼요.</li>
      <li>설치한 가구를 탭하면 이동·회전, 색상·크기, 복제, 삭제를 할 수 있어요.</li>
      <li>빨간 윤곽선은 벽·설비·다른 가구·문 열림 공간과 겹친다는 뜻이에요. 노란 숫자는 벽·가구까지 거리(cm)예요.</li>
    </ol>
  </div>
  <div class="section">
    <h3>도면 정보</h3>
    <p>${PLAN_INFO.title} ${PLAN_INFO.floor} · 계약면적 ${PLAN_INFO.contractArea}㎡ · 전용면적 ${PLAN_INFO.exclusiveArea}㎡. 벽·문·설비 위치는 평면도 이미지를 보고 옮긴 추정치예요. 창문 위치와 2층(다락)은 평면도에서 확인할 수 없어 넣지 않았어요.</p>
  </div>`;
  openSheet('settings', '설정', body);

  $('sApply').onclick = () => {
    const w = parseFloat($('sW').value), d = parseFloat($('sD').value), h = parseFloat($('sH').value);
    if (![w, d, h].every(Number.isFinite) || w < 3 || d < 3 || w > 20 || d > 20 || h < 2.1 || h > 4) {
      toast('가로·세로는 3~20m, 천장고는 2.1~4m 사이로 넣어 주세요');
      return;
    }
    applyPlanSize(w, d, h);
  };
  $('sReset').onclick = () => applyPlanSize(BASE.width, BASE.depth, BASE.wallHeight);
  const bindToggle = (id, key, after) => $(id).addEventListener('change', (e) => { st[key] = e.target.checked; save(); after && after(); });
  bindToggle('tMagnet', 'magnet');
  bindToggle('tMeasure', 'measure', () => { if (S.selectedId) select(S.selectedId); });
  bindToggle('tLabels', 'labels', () => { rebuildPlan(); });
  bindToggle('tShadows', 'shadows', () => S.viewer.setShadows(st.shadows));
  for (const b of $('sheetBody').querySelectorAll('[data-copy]')) {
    b.onclick = async () => {
      const to = Number(b.dataset.copy);
      const target = S.data.layouts[to];
      if (target.items.length && !(await confirmDialog('배치안 복사', `${target.name}에 있는 가구 ${target.items.length}개를 지금 배치로 덮어쓸까요?`, '덮어쓰기', true))) return;
      target.items = items().map((it) => ({ ...it, id: newId() }));
      save();
      renderLayoutTabs();
      toast(`${target.name}로 복사했어요`);
    };
  }
  $('sExample').onclick = async () => {
    if (items().length && !(await confirmDialog('예시 가구 놓기', '지금 배치를 지우고 평면도에 그려진 예시 가구로 바꿀까요?', '바꾸기', true))) return;
    const sx = S.data.plan.width / BASE.width, sz = S.data.plan.depth / BASE.depth;
    S.data.layouts[S.data.active].items = exampleItems().map((it) => ({ ...it, x: Math.round(it.x * sx), z: Math.round(it.z * sz) }));
    rebuildAllObjects();
    save();
    closeSheet();
    updateChrome();
  };
  $('sClear').onclick = async () => {
    if (!items().length) return toast('이미 비어 있어요');
    if (await confirmDialog('비우기', `${S.data.layouts[S.data.active].name}의 가구를 모두 지울까요?`, '비우기', true)) { clearLayout(); closeSheet(); }
  };
  $('sShot').onclick = () => { closeSheet(); setTimeout(takeScreenshot, 50); };
  $('sExport').onclick = () => { closeSheet(); exportDialog(); };
  $('sImport').onclick = () => { closeSheet(); importDialog(); };
}

function applyPlanSize(w, d, h) {
  const p = S.data.plan;
  const rx = w / p.width, rz = d / p.depth;
  for (const l of S.data.layouts) for (const it of l.items) { it.x = Math.round(it.x * rx * 10) / 10; it.z = Math.round(it.z * rz * 10) / 10; }
  Object.assign(p, { width: w, depth: d, wallHeight: h });
  rebuildPlan();
  rebuildAllObjects();
  S.viewer.setView(S.viewer.view);
  save();
  closeSheet();
  toast(`도면을 ${w.toFixed(2)} × ${d.toFixed(2)} m로 맞췄어요`);
}

// ───────────────────────────────────────── 저장 · 공유
function base64FromDataUrl(url) {
  return url.slice(url.indexOf(',') + 1);
}
function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function downloadUrl(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

function takeScreenshot() {
  S.overlay.hide();
  const url = S.viewer.screenshot();
  if (S.selectedId) select(S.selectedId);
  const name = `가구배치-${LAYOUT_NAMES[S.data.active].slice(-1)}-${stamp()}.png`;
  const actions = [];
  if (bridge) actions.push({ label: '사진첩에 저장', cls: 'btn-primary', run: () => { toast(bridge.saveFile(name, 'image/png', base64FromDataUrl(url))); } });
  else if (!inIframe) actions.push({ label: '이미지 저장', cls: 'btn-primary', run: () => downloadUrl(url, name) });
  actions.push({ label: '닫기' });
  modal({
    title: '화면 저장',
    body: `<img src="${url}" alt="현재 배치 화면">${bridge ? '' : '<p style="margin:0">이미지를 길게 누르면 휴대폰에 저장할 수 있어요.</p>'}`,
    actions,
  });
}

function exportDialog() {
  const text = exportJson(S.data);
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gap = '8px';
  wrap.innerHTML = `<p style="margin:0">아래 내용을 복사해 메모나 메신저에 보관하세요. 불러오기에 붙여 넣으면 배치안 A·B·C와 도면 보정값이 그대로 돌아와요.</p><textarea id="exText" readonly aria-label="내보낸 배치 데이터"></textarea>`;
  wrap.querySelector('textarea').value = text;
  const name = `가구배치-${stamp()}.json`;
  const actions = [{
    label: '복사', cls: 'btn-primary',
    run: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('복사했어요');
      } catch {
        const ta = $('exText');
        ta.focus();
        ta.select();
        toast('글자를 길게 눌러 복사해 주세요');
        return true;
      }
    },
  }];
  if (bridge) actions.push({ label: '파일로 저장', run: () => { toast(bridge.saveFile(name, 'application/json', utf8ToBase64(text))); } });
  else if (!inIframe) actions.push({ label: '파일로 저장', run: () => downloadUrl(URL.createObjectURL(new Blob([text], { type: 'application/json' })), name) });
  actions.push({ label: '닫기' });
  modal({ title: '내보내기', body: wrap, actions });
}

function importDialog() {
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gap = '8px';
  wrap.innerHTML = `<p style="margin:0">내보내기로 만든 내용을 붙여 넣거나 파일을 고르세요. 지금 배치안 A·B·C가 모두 바뀌어요.</p>
    <textarea id="imText" placeholder='{"app":"home3d-dungchon", ...}' aria-label="불러올 배치 데이터"></textarea>
    <label class="btn btn-sm" style="justify-self:start">${icon('upload')}파일 고르기<input id="imFile" type="file" accept=".json,application/json,text/plain" hidden></label>`;
  wrap.querySelector('#imFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) $('imText').value = await f.text();
  });
  modal({
    title: '불러오기', body: wrap,
    actions: [
      { label: '취소' },
      {
        label: '불러오기', cls: 'btn-primary',
        run: () => {
          try {
            const next = importJson($('imText').value);
            S.data = next;
            if (S.mode === 'placing') cancelPlacement();
            S.selectedId = null;
            rebuildPlan();
            rebuildAllObjects();
            S.viewer.setShadows(S.data.settings.shadows);
            save();
            updateChrome();
            toast('배치를 불러왔어요');
          } catch (err) {
            toast(err.message);
            return true;
          }
        },
      },
    ],
  });
}

// ───────────────────────────────────────── 1인칭
function enterEye() {
  if (S.mode === 'placing') return;
  S.selectedId = null;
  S.overlay.hide();
  S.mode = 'eye';
  rebuildPlan();
  const p = S.data.plan;
  S.viewer.enterEye(p.width * 0.88, p.depth * 0.9, 0.6);
  updateChrome();
}

function exitEye() {
  if (S.mode !== 'eye') return;
  S.mode = 'idle';
  S.viewer.exitEye();
  rebuildPlan();
  updateChrome();
  showHint();
}

function walkable(p) {
  if (!S.planBuild.interior.some((r) => pointInRect(p.x, p.z, r))) return false;
  return !S.planBuild.obstacles.some((o) => (o.kind === 'wall' || o.kind === 'fixture') && pointInRect(p.x, p.z, o.rect));
}

// ───────────────────────────────────────── 입력 처리
function attachGestures() {
  const el = S.viewer.renderer.domElement;
  const pointers = new Set();
  let g = null;
  el.addEventListener('pointerdown', (e) => {
    pointers.add(e.pointerId);
    if (pointers.size > 1) {
      if (g && g.kind === 'item') S.drag = null;
      g = null;
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: false, kind: null };
    if (S.mode === 'placing' && S.dragTarget === 'item') {
      g.kind = 'item';
      const f = S.viewer.floorPoint(e.clientX, e.clientY);
      S.drag = f ? { f0: f, x0: S.placing.item.x, z0: S.placing.item.z } : null;
    } else if (S.mode === 'eye') {
      g.kind = 'look';
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 7) g.moved = true;
    if (g.kind === 'item' && S.drag && g.moved) {
      const f = S.viewer.floorPoint(e.clientX, e.clientY);
      if (f) moveItemTo(S.drag.x0 + (f.x - S.drag.f0.x) * 100, S.drag.z0 + (f.z - S.drag.f0.z) * 100);
    } else if (g.kind === 'look') {
      S.viewer.look(e.clientX - g.lx, e.clientY - g.ly);
    }
    g.lx = e.clientX;
    g.ly = e.clientY;
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (!g || e.pointerId !== g.id) return;
    const tap = !g.moved && e.type === 'pointerup' && performance.now() - g.t < 500;
    S.drag = null;
    g = null;
    if (tap) onTap(e.clientX, e.clientY);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function onTap(x, y) {
  if (S.mode === 'eye') {
    const p = S.viewer.floorPoint(x, y);
    if (p && walkable(p)) S.viewer.walkTo(p.x, p.z);
    else toast('그곳으로는 갈 수 없어요');
    return;
  }
  if (S.mode === 'placing') {
    const p = S.viewer.floorPoint(x, y);
    if (p) moveItemTo(Math.round(p.x * 100), Math.round(p.z * 100));
    return;
  }
  const id = S.viewer.pickFurniture(x, y);
  if (id) select(id);
  else if (S.selectedId) deselect();
}

function handleBack() {
  if (closeModal()) return true;
  if (closeSheet()) return true;
  if (S.mode === 'placing') { cancelPlacement(); return true; }
  if (S.mode === 'eye') { exitEye(); return true; }
  if (S.selectedId) { deselect(); return true; }
  return false;
}
window.__onAndroidBack = handleBack;

function onKey(e) {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (e.key === 'Escape') { handleBack(); return; }
  if (S.mode === 'placing') {
    const step = e.shiftKey ? 10 : 1;
    const it = S.placing.item;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) { e.preventDefault(); moveItemTo(it.x + map[e.key][0], it.z + map[e.key][1]); return; }
    if (e.key === 'q' || e.key === 'Q') rotateBy(-15);
    if (e.key === 'e' || e.key === 'E') rotateBy(15);
    if (e.key === 'Enter') confirmPlacement();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.selectedId && S.mode === 'idle' && !S.sheet) deleteItem(S.selectedId);
}

// ───────────────────────────────────────── UI 바인딩
function bindUi() {
  $('toolRotate').innerHTML = `${icon('rotate')}<span>회전</span>`;
  $('toolPan').innerHTML = `${icon('pan')}<span>이동</span>`;
  $('toolAdd').innerHTML = `<span class="pill">${icon('plus')}</span><span>가구 배치</span>`;
  $('toolList').innerHTML = `${icon('list')}<span>목록</span><i class="badge" hidden></i>`;
  $('toolMore').innerHTML = `${icon('sliders')}<span>설정</span>`;
  $('sheetClose').innerHTML = icon('x');
  $('pbEdit').innerHTML = `${icon('edit')}색상·크기`;
  const sel = { move: ['move', '이동·회전'], edit: ['edit', '색상·크기'], dup: ['copy', '복제'], del: ['trash', '삭제'], close: ['x', ''] };
  for (const b of $('selbar').querySelectorAll('[data-act]')) {
    const [ic, label] = sel[b.dataset.act];
    b.innerHTML = icon(ic) + (label ? `<span>${label}</span>` : '');
  }

  $('toolRotate').onclick = () => { S.viewTool = 'rotate'; updateChrome(); showHint(); };
  $('toolPan').onclick = () => { S.viewTool = 'pan'; updateChrome(); showHint(); };
  $('toolAdd').onclick = () => openCatalog();
  $('toolList').onclick = () => openList();
  $('toolMore').onclick = () => openSettings();

  $('btnView').onclick = () => { S.viewer.setView(S.viewer.view === 'top' ? '3d' : 'top'); renderRail(); };
  $('btnWalls').onclick = () => {
    const order = ['full', 'half', 'low'];
    const st = S.data.settings;
    st.wallMode = order[(order.indexOf(st.wallMode) + 1) % order.length];
    rebuildPlan();
    save();
    renderRail();
    toast(WALL_MODES[st.wallMode].label);
  };
  $('btnEye').onclick = () => enterEye();
  $('btnHome').onclick = () => S.viewer.setView(S.viewer.view);
  $('eyeExit').onclick = () => exitEye();

  $('layoutTabs').onclick = (e) => {
    const b = e.target.closest('[data-layout]');
    if (!b || S.mode !== 'idle') return;
    const i = Number(b.dataset.layout);
    if (i === S.data.active) return;
    S.data.active = i;
    S.selectedId = null;
    S.overlay.hide();
    rebuildAllObjects();
    save();
    updateChrome();
    toast(`${S.data.layouts[i].name} · 가구 ${items().length}개`);
  };

  $('bannerClear').onclick = () => {
    S.data.settings.exampleNotice = false;
    const prev = items().slice();
    clearLayout();
    toast('예시 가구를 비웠어요', {
      label: '되돌리기',
      fn: () => { S.data.layouts[0].items = prev; rebuildAllObjects(); save(); updateChrome(); },
    });
  };
  $('bannerKeep').onclick = () => { S.data.settings.exampleNotice = false; save(); updateChrome(); };

  $('selbar').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !S.selectedId) return;
    const it = items().find((i) => i.id === S.selectedId);
    if (!it) return;
    switch (b.dataset.act) {
      case 'move': startPlacement(it, false); break;
      case 'edit': openProps(it, 'edit'); break;
      case 'dup': duplicateItem(it.id); break;
      case 'del': deleteItem(it.id); break;
      default: deselect();
    }
  };

  $('placebar').addEventListener('click', (e) => {
    const r = e.target.closest('[data-rot]');
    if (r) rotateBy(Number(r.dataset.rot));
  });
  $('pbSlider').addEventListener('input', (e) => setRotation(Number(e.target.value)));
  $('pbMove').onclick = () => { S.dragTarget = 'item'; refreshPlacement(); updateControls(); showHint(true); };
  $('pbView').onclick = () => { S.dragTarget = 'view'; refreshPlacement(); updateControls(); showHint(true); };
  $('pbEdit').onclick = () => openProps(S.placing.item, 'placing');
  $('pbCancel').onclick = () => cancelPlacement();
  $('pbConfirm').onclick = () => confirmPlacement();

  $('sheetClose').onclick = () => closeSheet();
  $('scrim').onclick = () => closeSheet();
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  window.addEventListener('keydown', onKey);
}

/** 3D 화면에서 상단 정보·보기 버튼·하단 도구 막대가 가리는 여백(px) */
function uiInsets() {
  const vp = $('viewport').getBoundingClientRect();
  const rail = $('rail');
  const rr = rail.getBoundingClientRect();
  const railRow = !rail.hidden && rr.width > rr.height;
  let top = 0;
  for (const el of [document.querySelector('.topbar .brand'), $('layoutTabs')]) top = Math.max(top, el.getBoundingClientRect().bottom - vp.top);
  if (railRow) top = Math.max(top, rr.bottom - vp.top);
  const tb = $('toolbar');
  const bottom = tb.hidden ? 16 : vp.bottom - tb.getBoundingClientRect().top;
  const right = !rail.hidden && !railRow ? vp.right - rr.left : 0;
  return { top: top + 10, bottom: bottom + 10, left: 10, right: right + 10 };
}

// ───────────────────────────────────────── 테마
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  S.viewer.setBackground(v('--bg') || '#e7e9e3');
  S.overlay.setColors({ accent: v('--accent') || '#2648b8', warn: v('--warn') || '#c84a1f', tape: v('--tape') || '#f3c22c' });
  if (S.selectedId) select(S.selectedId);
  if (S.placing) refreshPlacement();
}

// ───────────────────────────────────────── 시작
function start() {
  const loaded = loadState(storage);
  S.data = loaded.state;
  S.firstRun = loaded.firstRun;

  try {
    S.viewer = new Viewer($('viewport'));
  } catch (err) {
    const f = $('fatal');
    f.hidden = false;
    f.innerHTML = `<div><h2>3D 화면을 열 수 없어요</h2><p>이 브라우저나 기기에서 WebGL을 사용할 수 없어요. 최신 Chrome에서 다시 열어 주세요.</p></div>`;
    console.error(err);
    return;
  }
  S.overlay = new Overlay(S.viewer, $('labels'));
  S.viewer.insets = uiInsets;
  bindUi();
  readTheme();
  rebuildPlan();
  rebuildAllObjects();
  S.viewer.setShadows(S.data.settings.shadows);
  S.viewer.setView('3d', false);
  attachGestures();
  updateChrome();
  showHint();
  if (S.firstRun) save();

  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) mq.addEventListener('change', readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('pagehide', () => saveState(storage, S.data));
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(storage, S.data); });

  // 자동 테스트·디버깅용 핸들
  window.__home3d = { S, startPlacement, confirmPlacement, cancelPlacement, moveItemTo, rotateBy, select, openCatalog, openProps, createItem, evaluate, items };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
