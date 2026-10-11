// 등촌동 복층 세대 1층 평면도 (네이버페이 부동산 단지정보 이미지 기반 추정 모델)
//
// ▸ 원본 이미지에는 치수가 없다. 전용면적 50.16㎡(벽 중심선 기준)를 1층 외곽 윤곽에 맞춰
//   축척을 역산했다(약 86px = 1m). 따라서 아래 모든 수치는 "추정값"이며,
//   앱의 [설정 → 도면 크기 보정]에서 실측한 실내 가로·세로를 넣으면 비례 보정된다.
// ▸ 좌표계: 실내 왼쪽 위 모서리가 원점, x = 오른쪽(이미지 가로), z = 아래쪽(이미지 세로), 단위 m.
// ▸ 사각형은 [x1, z1, x2, z2].

export const PLAN_INFO = {
  title: '등촌동 복층',
  floor: '1층',
  exclusiveArea: 50.16, // ㎡ (전용면적, 출처: 평면도 화면)
  contractArea: 91.64,  // ㎡ (계약면적, 출처: 평면도 화면)
};

/** 추정 실내 치수와 천장고(기본값) */
export const BASE = { width: 6.36, depth: 7.38, wallHeight: 2.3 };

export const DOOR_HEIGHT = 2.1;

// kind: ext(외벽) | int(내벽) | mass(덕트·PS 등 막힌 벽체)
// n: 외벽의 바깥 방향 — 카메라 쪽 외벽을 자동으로 낮춰(컷어웨이) 안이 보이게 할 때 사용
export const WALLS = [
  { r: [-0.2, -0.2, 6.56, 0], kind: 'ext', n: [0, -1] },   // 북쪽 외벽 (현관문)
  { r: [-0.2, 0, 0, 7.58], kind: 'ext', n: [-1, 0] },      // 서쪽 외벽
  { r: [6.36, 0, 6.56, 8.1], kind: 'ext', n: [1, 0] },     // 동쪽 외벽
  { r: [0, 7.38, 5.35, 7.58], kind: 'ext', n: [0, 1] },    // 남쪽 외벽
  { r: [5.2, 7.58, 5.35, 8.1], kind: 'ext', n: [-1, 0] },  // 실외기실 서쪽 벽
  { r: [5.35, 7.9, 6.36, 8.1], kind: 'ext', n: [0, 1] },   // 실외기실 남쪽 벽
  { r: [5.35, 7.38, 6.36, 7.48], kind: 'int' },  // 거실 ↔ 실외기실 (유리문)
  { r: [2.21, 0, 2.33, 2.21], kind: 'int' },     // 작은방 동쪽 벽
  { r: [0, 2.21, 2.33, 2.36], kind: 'int' },     // 작은방 남쪽 벽
  { r: [2.21, 2.36, 2.33, 3.85], kind: 'int' },  // 욕실 동쪽 벽
  { r: [0, 3.85, 3.28, 3.97], kind: 'int' },     // 침실 북쪽 벽
  { r: [3.16, 3.97, 3.28, 7.38], kind: 'int' },  // 침실 동쪽 벽 (거실 소파 벽)
  { r: [4.75, 0, 4.85, 1.92], kind: 'int' },     // 창고 동쪽 벽
  { r: [3.95, 1.92, 4.85, 2.02], kind: 'int' },  // 창고 남쪽 벽
  { r: [0, 2.36, 0.5, 3.85], kind: 'mass' },     // 욕실 서쪽 두꺼운 벽체
  { r: [0.5, 2.36, 0.93, 2.85], kind: 'mass' },  // 욕실 덕트
  { r: [3.4, 0, 3.95, 1.92], kind: 'mass' },     // 현관 옆 PS/덕트
];

// axis: 문이 뚫린 방향(벽의 길이 방향). at: 벽 두께 중심 좌표. from~to: 개구부 범위.
// hinge: 'from' | 'to' 경첩 위치, swing: 열리는 쪽(+1 / -1, 벽에 수직인 축 기준)
export const DOORS = [
  { id: 'entry', name: '현관문', axis: 'x', at: -0.1, from: 2.75, to: 3.4, wallT: 0.2, kind: 'entry' },
  { id: 'room2', name: '작은방 문', axis: 'z', at: 2.27, from: 1.4, to: 2.15, wallT: 0.12, hinge: 'to', swing: -1, kind: 'swing' },
  { id: 'bath', name: '욕실 문', axis: 'z', at: 2.27, from: 3.02, to: 3.72, wallT: 0.12, hinge: 'to', swing: -1, kind: 'swing' },
  { id: 'bed', name: '침실 문', axis: 'x', at: 3.91, from: 2.42, to: 3.12, wallT: 0.12, hinge: 'to', swing: 1, kind: 'swing' },
  { id: 'store', name: '창고 문', axis: 'x', at: 1.97, from: 4.05, to: 4.65, wallT: 0.1, hinge: 'to', swing: -1, kind: 'swing' },
  { id: 'utility', name: '실외기실 유리문', axis: 'x', at: 7.43, from: 5.35, to: 6.36, wallT: 0.1, kind: 'slide' },
];

// rail: 계단을 오르는 방향 기준 난간 쪽. face: 앞면 방향. fixedSize: 도면 보정 시 크기는 유지하고 위치만 옮김.
// surface: 위에 물건(전자레인지 등)을 올릴 수 있는 면. decor: 충돌 판정 제외 장식.
export const FIXTURES = [
  { id: 'shoe', name: '신발장', kind: 'cabinet', r: [2.33, 0, 2.73, 1.3], h: 2.2, face: '+x', color: '#4b3427' },
  { id: 'counterA', name: '주방 싱크대', kind: 'counter', r: [4.85, 0, 6.36, 0.62], h: 0.86, face: '+z', surface: true },
  { id: 'counterB', name: '주방 싱크대', kind: 'counter', r: [5.74, 0.62, 6.36, 2.62], h: 0.86, face: '-x', surface: true },
  { id: 'sink', name: '개수대', kind: 'sink', r: [5.8, 1.15, 6.3, 1.75], h: 0.86, face: '-x', decor: true, fixedSize: true },
  { id: 'cooktop', name: '쿡탑', kind: 'cooktop', r: [5.8, 1.95, 6.3, 2.5], h: 0.86, face: '-x', decor: true, fixedSize: true },
  { id: 'toilet', name: '변기', kind: 'toilet', r: [1.33, 2.36, 1.71, 3.04], h: 0.78, face: '+z', fixedSize: true },
  { id: 'basin', name: '세면대', kind: 'basin', r: [1.76, 2.36, 2.21, 2.8], h: 0.86, face: '+z', fixedSize: true },
  { id: 'shower', name: '샤워 공간', kind: 'shower', r: [0.5, 2.85, 1.22, 3.85], h: 2.0, face: '+x' },
  { id: 'closet', name: '붙박이장', kind: 'closet', r: [0, 3.97, 0.72, 7.38], h: 2.3, face: '+x', color: '#ece8e1' },
  { id: 'steps', name: '계단형 단차(추정)', kind: 'steps', r: [1.0, 3.97, 2.38, 4.5], h: 0.54, steps: 3, up: '-x' },
  { id: 'stairs', name: '2층 계단', kind: 'stairs', r: [5.46, 3.0, 6.36, 4.75], h: 2.3, steps: 12, up: '-z', rail: 'left' },
];

// floor: wood | hex | tile | tile2. size: 라벨에 크기 표시
export const ROOMS = [
  { name: '작은방', r: [0, 0, 2.21, 2.21], size: true },
  { name: '현관', r: [2.33, 0, 3.4, 1.92], floor: 'hex' },
  { name: '창고', r: [3.95, 0, 4.75, 1.92] },
  { name: '욕실', r: [0.5, 2.36, 2.21, 3.85], floor: 'tile', size: true },
  { name: '침실', r: [0, 3.97, 3.16, 7.38], size: true, labelAt: [2.0, 6.6] },
  { name: '주방', r: [4.85, 0, 6.36, 2.62], labelAt: [5.25, 1.35] },
  { name: '식당', r: [3.4, 2.02, 4.85, 3.4], labelAt: [4.1, 2.3] },
  { name: '거실', r: [3.28, 4.75, 6.36, 7.38], labelAt: [4.8, 7.05] },
  { name: '실외기실(추정)', r: [5.35, 7.48, 6.36, 7.9], floor: 'tile2', small: true },
];

/** 바닥이 깔린 실내 영역 (집 밖 판정용) */
export const INTERIOR = [
  [0, 0, 6.36, 7.38],
  [5.35, 7.38, 6.36, 7.9],
];

/** 외곽 슬래브(모형 받침) */
export const SLABS = [
  [-0.2, -0.2, 6.56, 7.58],
  [5.2, 7.38, 6.56, 8.1],
];

const sr = (r, sx, sz) => [r[0] * sx, r[1] * sz, r[2] * sx, r[3] * sz];

/** 크기는 유지하고 벽에 붙은 뒷면 중심만 비례 이동 */
function anchorScale(r, face, sx, sz) {
  const w = r[2] - r[0], d = r[3] - r[1];
  let ax = (r[0] + r[2]) / 2, az = (r[1] + r[3]) / 2;
  if (face === '+z') az = r[1];
  else if (face === '-z') az = r[3];
  else if (face === '+x') ax = r[0];
  else if (face === '-x') ax = r[2];
  const nx = ax * sx, nz = az * sz;
  if (face === '+z') return [nx - w / 2, nz, nx + w / 2, nz + d];
  if (face === '-z') return [nx - w / 2, nz - d, nx + w / 2, nz];
  if (face === '+x') return [nx, nz - d / 2, nx + w, nz + d / 2];
  if (face === '-x') return [nx - w, nz - d / 2, nx, nz + d / 2];
  return [nx - w / 2, nz - d / 2, nx + w / 2, nz + d / 2];
}

/**
 * 실내 가로·세로(m)에 맞춰 도면을 비례 보정한 사본을 만든다.
 */
export function scaledPlan(width = BASE.width, depth = BASE.depth, wallHeight = BASE.wallHeight) {
  const sx = width / BASE.width, sz = depth / BASE.depth;
  const scaleDoor = (d) => {
    const along = d.axis === 'x' ? sx : sz;
    const across = d.axis === 'x' ? sz : sx;
    return { ...d, at: d.at * across, from: d.from * along, to: d.to * along };
  };
  return {
    width, depth, wallHeight, sx, sz,
    walls: WALLS.map((w) => ({ ...w, r: sr(w.r, sx, sz) })),
    doors: DOORS.map(scaleDoor),
    fixtures: FIXTURES.map((f) => ({ ...f, r: f.fixedSize ? anchorScale(f.r, f.face, sx, sz) : sr(f.r, sx, sz) })),
    rooms: ROOMS.map((rm) => ({ ...rm, r: sr(rm.r, sx, sz), labelAt: rm.labelAt ? [rm.labelAt[0] * sx, rm.labelAt[1] * sz] : null })),
    interior: INTERIOR.map((r) => sr(r, sx, sz)),
    slabs: SLABS.map((r) => sr(r, sx, sz)),
  };
}

/** 문이 열리는 반경(충돌 경고용 사각형). 미닫이·현관문(바깥 열림)은 없음 */
export function doorSwingRect(d) {
  if (d.kind !== 'swing') return null;
  const width = d.to - d.from;
  const near = d.at + d.swing * d.wallT / 2;
  const far = near + d.swing * width;
  const a = Math.min(near, far), b = Math.max(near, far);
  return d.axis === 'x' ? [d.from, a, d.to, b] : [a, d.from, b, d.to];
}
