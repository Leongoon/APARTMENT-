// 상태 저장 · 검증 · 예시 배치
// 단위: 가구 크기·위치·설치 높이 모두 cm, 회전은 도(°). 도면 크기는 m.
import { CATALOG_BY_TYPE, catalogItem } from './catalog.js';
import { BASE } from './planData.js';

export const STORAGE_KEY = 'home3d.dungchon.v1';
export const LAYOUT_NAMES = ['배치안 A', '배치안 B', '배치안 C'];

let seq = 0;
export function newId() {
  seq = (seq + 1) % 1e6;
  return Date.now().toString(36) + '-' + seq.toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

const num = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const isHex = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
const round1 = (n) => Math.round(n * 10) / 10;

/** 카탈로그 기본값으로 새 가구 */
export function createItem(type, overrides = {}) {
  const def = catalogItem(type);
  return sanitizeItem({
    id: newId(),
    type: def.type,
    name: def.name,
    color: def.color,
    w: def.size[0], d: def.size[1], h: def.size[2],
    x: 0, z: 0,
    elev: def.elev || 0,
    elevAuto: !!def.stackable,
    rot: 0,
    flip: false,
    ...overrides,
  });
}

export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = CATALOG_BY_TYPE[raw.type] ? raw.type : 'box';
  const def = CATALOG_BY_TYPE[type];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newId(),
    type,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : def.name,
    color: isHex(raw.color) ? raw.color.toLowerCase() : def.color,
    w: round1(num(raw.w, 1, 1000, def.size[0])),
    d: round1(num(raw.d, 1, 1000, def.size[1])),
    h: round1(num(raw.h, 1, 400, def.size[2])),
    x: round1(num(raw.x, -500, 1500, 0)),
    z: round1(num(raw.z, -500, 1500, 0)),
    elev: round1(num(raw.elev, 0, 300, def.elev || 0)),
    elevAuto: raw.elevAuto == null ? !!def.stackable : !!raw.elevAuto,
    rot: ((Math.round(num(raw.rot, -100000, 100000, 0)) % 360) + 360) % 360,
    flip: !!raw.flip,
  };
}

export function defaultSettings() {
  return { wallMode: 'full', magnet: true, measure: true, shadows: true, labels: true, exampleNotice: true };
}

export function defaultState() {
  return {
    version: 1,
    plan: { width: BASE.width, depth: BASE.depth, wallHeight: BASE.wallHeight },
    settings: defaultSettings(),
    active: 0,
    layouts: LAYOUT_NAMES.map((name, i) => ({ name, items: i === 0 ? exampleItems() : [] })),
  };
}

export function sanitizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const plan = raw.plan || {};
  const settings = { ...defaultSettings(), ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) };
  if (!['full', 'half', 'low'].includes(settings.wallMode)) settings.wallMode = 'full';
  for (const k of ['magnet', 'measure', 'shadows', 'labels', 'exampleNotice']) settings[k] = !!settings[k];
  const layouts = Array.isArray(raw.layouts) ? raw.layouts : [];
  return {
    version: 1,
    plan: {
      width: num(plan.width, 3, 20, BASE.width),
      depth: num(plan.depth, 3, 20, BASE.depth),
      wallHeight: num(plan.wallHeight, 2.1, 4, BASE.wallHeight),
    },
    settings,
    active: Math.round(num(raw.active, 0, LAYOUT_NAMES.length - 1, 0)),
    layouts: LAYOUT_NAMES.map((name, i) => {
      const l = layouts[i];
      const items = l && Array.isArray(l.items) ? l.items.map(sanitizeItem).filter(Boolean).slice(0, 300) : [];
      // 같은 id 가 섞여 들어오면 새 id 부여
      const seen = new Set();
      for (const it of items) {
        if (seen.has(it.id)) it.id = newId();
        seen.add(it.id);
      }
      return { name, items };
    }),
  };
}

export function loadState(storage) {
  try {
    const text = storage && storage.getItem(STORAGE_KEY);
    if (!text) return { state: defaultState(), firstRun: true };
    return { state: sanitizeState(JSON.parse(text)), firstRun: false };
  } catch {
    return { state: defaultState(), firstRun: true };
  }
}

export function saveState(storage, state) {
  try {
    storage && storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** 내보내기용 JSON 문자열 */
export function exportJson(state) {
  return JSON.stringify({ app: 'home3d-dungchon', exportedAt: new Date().toISOString(), ...state }, null, 1);
}

/** 가져오기: 문자열 → 검증된 상태. 실패 시 Error */
export function importJson(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 아니에요. 내보내기로 만든 내용을 그대로 붙여 넣어 주세요.');
  }
  if (!raw || !Array.isArray(raw.layouts)) throw new Error('배치 데이터(layouts)가 없어요.');
  return sanitizeState(raw);
}

/**
 * 원본 평면도 이미지에 그려진 가구를 기본 도면 좌표(cm)로 옮긴 예시.
 * (책상·의자, 침대, 식탁 세트, 3인 소파, 소파 테이블)
 */
export function exampleItems() {
  const it = (type, x, z, rot, extra = {}) => createItem(type, { x, z, rot, ...extra });
  return [
    it('desk', 120, 30, 0, { color: '#6b4630' }),
    it('officechair', 120, 92, 180),
    it('bed_queen', 228, 576, 0, { color: '#e8e4dc' }),
    it('dining4', 420, 274, 90, { color: '#7b4b32' }),
    it('chair', 361, 247, 90, { color: '#f2efe9' }),
    it('chair', 361, 301, 90, { color: '#f2efe9' }),
    it('chair', 479, 247, 270, { color: '#f2efe9' }),
    it('chair', 479, 301, 270, { color: '#f2efe9' }),
    it('sofa3', 373, 568, 90, { color: '#d9d4c9' }),
    it('coffee', 462, 568, 90, { w: 120, d: 50, color: '#7b4b32' }),
  ];
}
