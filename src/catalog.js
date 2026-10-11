// 가구 카탈로그 (순수 데이터). 크기 단위: cm, [가로 W, 깊이 D, 높이 H]
// - 가로: 정면에서 본 폭, 깊이: 앞뒤 길이, 높이: 바닥에서 가장 높은 곳까지
// - 기본 크기는 국내에서 흔한 규격을 참고한 대표값이며, 앱에서 자유롭게 수정할 수 있다.
//
// 필드
//   builder   : models.js 의 3D 모델 생성 함수 이름
//   surface   : 위에 물건을 올릴 수 있음 (TV, 모니터, 전자레인지 등이 자동으로 올라감)
//   stackable : 아래에 surface 가구가 있으면 그 위에 자동으로 올라감
//   kind      : 'chair' 는 'table' 아래로 밀어 넣어도 겹침 경고를 하지 않음
//   noCollide : 러그처럼 다른 가구와 겹쳐도 되는 물건
//   elev      : 기본 설치 높이(cm, 바닥에서 아래면까지) — 벽걸이 TV·에어컨
//   variants  : 속성 창에서 빠르게 바꿀 수 있는 규격 프리셋 그룹

export const CATEGORIES = [
  { id: 'bed', name: '침실' },
  { id: 'living', name: '거실' },
  { id: 'dining', name: '주방·식탁' },
  { id: 'work', name: '서재' },
  { id: 'storage', name: '수납' },
  { id: 'appliance', name: '가전' },
  { id: 'etc', name: '소품·기타' },
];

const BED_NOTE = (m) => `매트리스 ${m}×2000mm 기준, 프레임 포함 크기`;

export const CATALOG = [
  // ── 침실
  { type: 'bed_single', cat: 'bed', name: '싱글 침대', builder: 'bed', size: [106, 212, 95], color: '#b89a7a', note: BED_NOTE(1000), variants: 'bed' },
  { type: 'bed_ss', cat: 'bed', name: '슈퍼싱글 침대', builder: 'bed', size: [116, 212, 95], color: '#c8b49a', note: BED_NOTE(1100), variants: 'bed' },
  { type: 'bed_queen', cat: 'bed', name: '퀸 침대', builder: 'bed', size: [156, 212, 100], color: '#8c6a50', note: BED_NOTE(1500), variants: 'bed' },
  { type: 'bed_king', cat: 'bed', name: '킹 침대', builder: 'bed', size: [166, 212, 100], color: '#5f6b73', note: BED_NOTE(1600), variants: 'bed' },
  { type: 'bed_lking', cat: 'bed', name: '라지킹 침대', builder: 'bed', size: [186, 212, 105], color: '#d3cbbf', note: BED_NOTE(1800), variants: 'bed' },
  { type: 'nightstand', cat: 'bed', name: '협탁', builder: 'drawers', size: [45, 40, 50], color: '#d9c7ad', surface: true, opts: { rows: 2 } },
  { type: 'wardrobe', cat: 'bed', name: '옷장', builder: 'wardrobe', size: [100, 60, 210], color: '#ece8e1' },
  { type: 'dresser', cat: 'bed', name: '서랍장', builder: 'drawers', size: [80, 45, 90], color: '#d9c7ad', surface: true, opts: { rows: 4 } },
  { type: 'vanity', cat: 'bed', name: '화장대', builder: 'vanity', size: [80, 40, 140], color: '#efe9df' },
  { type: 'mirror', cat: 'bed', name: '전신 거울', builder: 'mirror', size: [50, 40, 160], color: '#c8a46e' },
  { type: 'hanger', cat: 'bed', name: '행거', builder: 'hanger', size: [120, 45, 170], color: '#2e2e2e' },

  // ── 거실
  { type: 'sofa2', cat: 'living', name: '2인 소파', builder: 'sofa', size: [160, 85, 80], color: '#8a8f94', variants: 'sofa' },
  { type: 'sofa3', cat: 'living', name: '3인 소파', builder: 'sofa', size: [210, 90, 80], color: '#c9c1b4', variants: 'sofa' },
  { type: 'sofa4', cat: 'living', name: '4인 소파', builder: 'sofa', size: [260, 95, 82], color: '#6f7c6a', variants: 'sofa' },
  { type: 'sofaL', cat: 'living', name: '카우치 소파 (L형)', builder: 'sofaL', size: [260, 160, 80], color: '#a7aeb4', note: '좌우 반전으로 카우치 방향 변경' },
  { type: 'armchair', cat: 'living', name: '1인 소파', builder: 'sofa', size: [85, 85, 80], color: '#c47a4a', variants: 'sofa' },
  { type: 'tv', cat: 'living', name: 'TV (스탠드형)', builder: 'tv', size: [123, 25, 78], color: '#1b1b1b', stackable: true, variants: 'tv', note: '55인치 기준. 거실장 위에 놓으면 자동으로 올라감' },
  { type: 'tv_wall', cat: 'living', name: '벽걸이 TV', builder: 'tvWall', size: [145, 5, 83], color: '#1b1b1b', elev: 100, variants: 'tvWall', note: '65인치 기준. 설치 높이로 벽걸이 높이 조절' },
  { type: 'tvstand', cat: 'living', name: 'TV 거실장', builder: 'lowCabinet', size: [180, 40, 45], color: '#f1ede6', surface: true, opts: { doors: 3 } },
  { type: 'coffee', cat: 'living', name: '소파 테이블', builder: 'coffeeTable', size: [100, 50, 40], color: '#9b6b43', surface: true, kind: 'table' },
  { type: 'sidetable', cat: 'living', name: '원형 사이드 테이블', builder: 'roundSide', size: [45, 45, 55], color: '#e6e2da', surface: true, kind: 'table' },
  { type: 'rug', cat: 'living', name: '러그', builder: 'rug', size: [200, 140, 1], color: '#d8cfc0', noCollide: true },
  { type: 'floorlamp', cat: 'living', name: '플로어 스탠드', builder: 'floorLamp', size: [40, 40, 160], color: '#efe6d2' },

  // ── 주방·식탁
  { type: 'dining2', cat: 'dining', name: '2인 식탁', builder: 'table', size: [80, 70, 75], color: '#c8a27a', surface: true, kind: 'table', variants: 'dining' },
  { type: 'dining4', cat: 'dining', name: '4인 식탁', builder: 'table', size: [120, 80, 75], color: '#7b4b32', surface: true, kind: 'table', variants: 'dining' },
  { type: 'dining6', cat: 'dining', name: '6인 식탁', builder: 'table', size: [160, 90, 75], color: '#f0ece6', surface: true, kind: 'table', variants: 'dining' },
  { type: 'diningRound', cat: 'dining', name: '원형 식탁', builder: 'roundTable', size: [90, 90, 75], color: '#e8e2d8', surface: true, kind: 'table' },
  { type: 'chair', cat: 'dining', name: '식탁 의자', builder: 'chair', size: [45, 52, 85], color: '#a77d5b', kind: 'chair' },
  { type: 'stool', cat: 'dining', name: '스툴', builder: 'stool', size: [35, 35, 45], color: '#c9a77f', kind: 'chair' },

  // ── 서재
  { type: 'desk', cat: 'work', name: '책상', builder: 'desk', size: [120, 60, 74], color: '#e9e4da', surface: true, kind: 'table', note: '탁상형(데스크형) 테이블' },
  { type: 'lowtable', cat: 'work', name: '좌식 테이블', builder: 'lowTable', size: [100, 60, 35], color: '#c8a27a', surface: true, kind: 'table', note: '바닥에 앉아 쓰는 낮은 탁상형 테이블' },
  { type: 'officechair', cat: 'work', name: '사무용 의자', builder: 'officeChair', size: [62, 62, 110], color: '#33363a', kind: 'chair' },
  { type: 'bookshelf', cat: 'work', name: '책장', builder: 'bookshelf', size: [80, 30, 180], color: '#f0ece4' },
  { type: 'monitor', cat: 'work', name: '모니터 (27인치)', builder: 'monitor', size: [62, 20, 45], color: '#202225', stackable: true },

  // ── 수납
  { type: 'cabinet', cat: 'storage', name: '수납장', builder: 'lowCabinet', size: [80, 40, 80], color: '#e7e1d6', surface: true, opts: { doors: 2 } },
  { type: 'tallcabinet', cat: 'storage', name: '키큰 수납장', builder: 'wardrobe', size: [60, 40, 180], color: '#f2efe9' },
  { type: 'shoerack', cat: 'storage', name: '보조 신발장', builder: 'drawers', size: [60, 30, 100], color: '#ddd5c8', surface: true, opts: { rows: 3 } },

  // ── 가전
  { type: 'fridge2', cat: 'appliance', name: '양문형 냉장고', builder: 'fridge', size: [91, 92, 180], color: '#cfd3d6' },
  { type: 'fridge', cat: 'appliance', name: '일반 냉장고', builder: 'fridge', size: [70, 72, 180], color: '#e4e6e7' },
  { type: 'kimchi', cat: 'appliance', name: '김치냉장고 (스탠드)', builder: 'kimchi', size: [70, 80, 185], color: '#d9d6d0' },
  { type: 'washer', cat: 'appliance', name: '드럼 세탁기', builder: 'washer', size: [60, 65, 85], color: '#f4f4f2', surface: true },
  { type: 'dryer', cat: 'appliance', name: '건조기', builder: 'washer', size: [60, 65, 85], color: '#f4f4f2', surface: true, stackable: true, opts: { dryer: true }, note: '세탁기 위에 놓으면 자동으로 올라감' },
  { type: 'microwave', cat: 'appliance', name: '전자레인지', builder: 'microwave', size: [50, 38, 29], color: '#2b2d30', stackable: true, note: '싱크대·수납장 위에 놓으면 자동으로 올라감' },
  { type: 'acStand', cat: 'appliance', name: '스탠드 에어컨', builder: 'acStand', size: [40, 35, 185], color: '#f5f5f3' },
  { type: 'acWall', cat: 'appliance', name: '벽걸이 에어컨', builder: 'acWall', size: [90, 25, 30], color: '#f5f5f3', elev: 195 },
  { type: 'purifier', cat: 'appliance', name: '공기청정기', builder: 'purifier', size: [30, 30, 70], color: '#f2f2f0' },

  // ── 소품·기타
  { type: 'plant', cat: 'etc', name: '화분 (대형)', builder: 'plant', size: [45, 45, 120], color: '#d9d4cb' },
  { type: 'box', cat: 'etc', name: '직접 입력 (상자)', builder: 'box', size: [60, 40, 60], color: '#9fb4c7', note: '목록에 없는 가구는 이름과 크기를 입력해 상자로 배치' },
];

/** 같은 가구 종류 안에서 규격을 빠르게 바꾸는 프리셋 (cm) */
export const VARIANTS = {
  bed: [
    { label: '싱글', name: '싱글 침대', size: [106, 212] },
    { label: '슈퍼싱글', name: '슈퍼싱글 침대', size: [116, 212] },
    { label: '퀸', name: '퀸 침대', size: [156, 212] },
    { label: '킹', name: '킹 침대', size: [166, 212] },
    { label: '라지킹', name: '라지킹 침대', size: [186, 212] },
  ],
  sofa: [
    { label: '1인', name: '1인 소파', size: [85, 85] },
    { label: '2인', name: '2인 소파', size: [160, 85] },
    { label: '3인', name: '3인 소파', size: [210, 90] },
    { label: '4인', name: '4인 소파', size: [260, 95] },
  ],
  tv: [
    { label: '43"', size: [97, 25, 63] },
    { label: '55"', size: [123, 25, 78] },
    { label: '65"', size: [145, 27, 90] },
    { label: '75"', size: [167, 30, 103] },
    { label: '85"', size: [189, 33, 116] },
  ],
  tvWall: [
    { label: '43"', size: [97, 5, 56] },
    { label: '55"', size: [123, 5, 71] },
    { label: '65"', size: [145, 5, 83] },
    { label: '75"', size: [167, 5, 96] },
    { label: '85"', size: [189, 5, 108] },
  ],
  dining: [
    { label: '2인', name: '2인 식탁', size: [80, 70] },
    { label: '4인', name: '4인 식탁', size: [120, 80] },
    { label: '6인', name: '6인 식탁', size: [160, 90] },
  ],
};

/** 빠른 색상 선택 팔레트 */
export const SWATCHES = [
  { name: '화이트', hex: '#f4f2ee' },
  { name: '아이보리', hex: '#ece3d0' },
  { name: '베이지', hex: '#d8c6a8' },
  { name: '라이트그레이', hex: '#c4c7c9' },
  { name: '그레이', hex: '#8a8f94' },
  { name: '차콜', hex: '#45494d' },
  { name: '블랙', hex: '#1d1e20' },
  { name: '오크', hex: '#c8a27a' },
  { name: '월넛', hex: '#7b4b32' },
  { name: '네이비', hex: '#2f3e5c' },
  { name: '세이지', hex: '#8fa58a' },
  { name: '테라코타', hex: '#c47a4a' },
  { name: '머스타드', hex: '#d1a53a' },
  { name: '더스티핑크', hex: '#d7a7a2' },
];

export const CATALOG_BY_TYPE = Object.fromEntries(CATALOG.map((c) => [c.type, c]));

export function catalogItem(type) {
  return CATALOG_BY_TYPE[type] || CATALOG_BY_TYPE.box;
}
