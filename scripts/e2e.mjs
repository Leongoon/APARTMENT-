// 헤드리스 Chromium 스모크 테스트: 모바일 화면에서 주요 흐름을 실행하고 스크린샷을 남긴다.
//   npm run build && npm run test:e2e
// 환경변수: SHOTS_DIR(스크린샷 폴더, 기본 dist/e2e), PLAYWRIGHT_MODULE(playwright 모듈 경로)
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS_DIR || path.join(root, 'dist/e2e');
await mkdir(shots, { recursive: true });

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const c of candidates) {
    try {
      return createRequire(import.meta.url)(c);
    } catch { /* 다음 후보 */ }
  }
  throw new Error('playwright 모듈을 찾을 수 없어요 (PLAYWRIGHT_MODULE 로 경로 지정)');
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const url = pathToFileURL(path.join(root, 'dist/index.html')).href;
const errors = [];
let step = 0;
const results = [];

async function newPage(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__home3d && document.querySelector('canvas'));
  await page.waitForTimeout(1200);
  return page;
}

async function shot(page, name) {
  step++;
  const file = path.join(shots, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

function check(cond, msg) {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) process.exitCode = 1;
}

const mobile = { viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' };
const page = await newPage(mobile);
await shot(page, 'initial');
check(await page.evaluate(() => window.__home3d.items().length === 10), '첫 실행 시 예시 가구 10개');

// 가구 선택
await page.evaluate(() => { const it = window.__home3d.items().find((i) => i.type === 'bed_queen'); window.__home3d.select(it.id); });
await page.waitForTimeout(300);
check(await page.isVisible('#selbar'), '가구 선택 시 선택 막대 표시');
await shot(page, 'selected-bed');
await page.click('#selbar [data-act="close"]');

// 카탈로그 → 킹 침대 → 색상/크기 입력 → 배치
await page.click('#toolAdd');
await page.waitForTimeout(900);
await shot(page, 'catalog');
check(await page.locator('#cGrid .card').count() >= 40, '카탈로그 카드 40개 이상');
await page.click('.cats [data-cat="bed"]');
await page.waitForTimeout(400);
await page.click('#cGrid [data-type="bed_king"]');
await page.waitForTimeout(300);
await page.click('#pSwatches [data-hex="#2f3e5c"]');
await page.fill('#pW', '170');
await page.dispatchEvent('#pW', 'change');
await page.waitForTimeout(250);
await shot(page, 'props-king-bed');
await page.click('#pPlace');
await page.waitForTimeout(400);
check(await page.isVisible('#placebar'), '배치하기 → 배치 패널 표시');
const placing = await page.evaluate(() => ({ ...window.__home3d.S.placing.item }));
check(placing.w === 170 && placing.color === '#2f3e5c', `입력한 크기·색상 반영 (w=${placing.w}, color=${placing.color})`);
await shot(page, 'placing');

// 드래그로 이동 (마우스 포인터) + 회전
const box = await page.locator('#viewport canvas').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height * 0.45;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(cx - i * 6, cy + i * 9);
await page.mouse.up();
await page.waitForTimeout(200);
const moved = await page.evaluate(() => ({ ...window.__home3d.S.placing.item }));
check(moved.x !== placing.x || moved.z !== placing.z, `드래그로 위치 이동 (${placing.x},${placing.z} → ${moved.x},${moved.z})`);
await page.click('[data-rot="90"]');
await page.waitForTimeout(150);
const rotated = await page.evaluate(() => window.__home3d.S.placing.item.rot);
check(rotated === (placing.rot + 90) % 360, `+90° 회전 (${placing.rot} → ${rotated})`);
await shot(page, 'placing-moved-rotated');

// 시점 회전 모드에서는 드래그해도 가구가 그대로
await page.click('#pbView');
const before = await page.evaluate(() => ({ x: window.__home3d.S.placing.item.x, z: window.__home3d.S.placing.item.z }));
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 12, cy);
await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({ x: window.__home3d.S.placing.item.x, z: window.__home3d.S.placing.item.z }));
check(before.x === after.x && before.z === after.z, '시점 회전 중 가구 고정');
await shot(page, 'placing-view-rotated');
await page.click('#pbMove');

// 결정
const count0 = await page.evaluate(() => window.__home3d.items().length);
await page.click('#pbConfirm');
await page.waitForTimeout(300);
const count1 = await page.evaluate(() => window.__home3d.items().length);
check(count1 === count0 + 1, `[결정] 후 가구 추가 (${count0} → ${count1})`);
check(await page.isVisible('#toolbar'), '[결정] 후 도구 막대 복귀');
await shot(page, 'confirmed');

// TV 거실장 위 TV 자동 올림
const stack = await page.evaluate(() => {
  const h = window.__home3d;
  const stand = h.createItem('tvstand');
  h.startPlacement(stand, true);
  h.moveItemTo(560, 600);
  h.confirmPlacement();
  const tv = h.createItem('tv');
  h.startPlacement(tv, true);
  h.moveItemTo(560, 600);
  const elev = h.S.placing.item.elev;
  h.confirmPlacement();
  return { elev, standH: stand.h };
});
check(stack.elev === stack.standH, `TV가 거실장 위로 자동 배치 (TV 높이 ${stack.elev}cm, 거실장 ${stack.standH}cm)`);

// 평면 보기 · 벽 낮게 · 1인칭
await page.click('#btnView');
await page.waitForTimeout(800);
await shot(page, 'top-view');
await page.click('#btnWalls');
await page.click('#btnWalls');
await page.waitForTimeout(400);
await shot(page, 'top-view-low-walls');
await page.click('#btnView');
await page.waitForTimeout(800);
await shot(page, '3d-low-walls');
await page.click('#btnWalls');
await page.click('#btnEye');
await page.waitForTimeout(500);
check(await page.isVisible('#eyebar'), '1인칭 보기 진입');
await shot(page, 'eye-level');
await page.click('#eyeExit');
await page.waitForTimeout(400);

// 목록 · 설정
await page.click('#toolList');
await page.waitForTimeout(300);
await shot(page, 'list');
await page.click('#sheetClose');
await page.click('#toolMore');
await page.waitForTimeout(300);
await shot(page, 'settings');
await page.click('#sheetClose');

// 화면에서 소파를 직접 탭해서 선택 → 색상 바꾸기 → 복제 → 삭제·되돌리기
await page.click('#btnHome');
await page.waitForTimeout(700);
const sofaPt = await page.evaluate(() => {
  const h = window.__home3d;
  const sofa = h.items().find((i) => i.type === 'sofa3');
  const p = h.S.viewer.toScreen(new (h.S.viewer.camera.position.constructor)(sofa.x / 100, 0.5, sofa.z / 100));
  return { id: sofa.id, ...p };
});
await page.mouse.click(sofaPt.x, sofaPt.y);
await page.waitForTimeout(300);
check(await page.evaluate((id) => window.__home3d.S.selectedId === id, sofaPt.id), '화면 탭으로 소파 선택');
await page.click('#selbar [data-act="edit"]');
await page.waitForTimeout(300);
await page.click('#pSwatches [data-hex="#8fa58a"]');
await page.click('#pDone');
check(await page.evaluate((id) => window.__home3d.items().find((i) => i.id === id).color === '#8fa58a', sofaPt.id), '배치된 가구 색상 변경');
await shot(page, 'sofa-recolored');
const c0 = await page.evaluate(() => window.__home3d.items().length);
await page.mouse.click(sofaPt.x, sofaPt.y);
await page.waitForTimeout(200);
await page.click('#selbar [data-act="dup"]');
await page.waitForTimeout(200);
await page.click('#pbConfirm');
check(await page.evaluate(() => window.__home3d.items().length) === c0 + 1, '복제 후 [결정]으로 추가');
await page.evaluate((id) => window.__home3d.select(id), sofaPt.id);
await page.click('#selbar [data-act="del"]');
check(await page.evaluate(() => window.__home3d.items().length) === c0, '삭제');
await page.click('#toast button');
check(await page.evaluate(() => window.__home3d.items().length) === c0 + 1, '삭제 되돌리기');

// 배치안 B 로 전환 → 비어 있음 → A 로 복귀
await page.click('#layoutTabs [data-layout="1"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__home3d.items().length === 0 && window.__home3d.S.objects.size === 0), '배치안 B는 비어 있음');
await page.click('#layoutTabs [data-layout="0"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__home3d.items().length) === c0 + 1, '배치안 A 복귀');

// 도면 크기 보정: 가로 10% 늘리면 가구 x 좌표도 비례
const x0 = await page.evaluate((id) => window.__home3d.items().find((i) => i.id === id).x, sofaPt.id);
await page.click('#toolMore');
await page.fill('#sW', '7.00');
await page.click('#sApply');
await page.waitForTimeout(700);
const x1 = await page.evaluate((id) => window.__home3d.items().find((i) => i.id === id).x, sofaPt.id);
check(Math.abs(x1 - x0 * (7 / 6.36)) < 0.2, `도면 보정 시 가구 위치 비례 이동 (${x0} → ${x1})`);
await shot(page, 'calibrated-7m');
await page.click('#toolMore');
await page.click('#sReset');
await page.waitForTimeout(500);

// 내보내기 → 불러오기 왕복
await page.click('#toolMore');
await page.click('#sExport');
await page.waitForTimeout(200);
const exported = await page.inputValue('#exText');
await page.click('#modalActions .btn:last-child');
await page.evaluate(() => { window.__home3d.S.data.layouts[0].items.length = 0; });
await page.click('#toolMore');
await page.click('#sImport');
await page.fill('#imText', exported);
await page.click('#modalActions .btn-primary');
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__home3d.items().length) === c0 + 1, '내보내기 → 불러오기 복원');

// 화면 저장
await page.click('#toolMore');
await page.click('#sShot');
await page.waitForTimeout(400);
check(await page.evaluate(() => (document.querySelector('#modalBody img') || {}).src?.startsWith('data:image/png')), '화면 저장 이미지 생성');
await shot(page, 'screenshot-modal');
await page.click('#modalActions .btn:last-child');

// 저장 후 새로고침 유지
await page.waitForTimeout(400);
const n = await page.evaluate(() => window.__home3d.items().length);
await page.reload();
await page.waitForFunction(() => window.__home3d);
await page.waitForTimeout(800);
check(await page.evaluate(() => window.__home3d.items().length) === n, `새로고침 후 배치 유지 (${n}개)`);

// 실제 터치 입력 (CDP): 대기 중 한 손가락 = 시점 회전, 배치 중 한 손가락 = 가구 이동, 두 손가락 = 확대(가구 고정)
{
  const cdp = await page.context().newCDPSession(page);
  const cv = await page.locator('#viewport canvas').boundingBox();
  const tx = cv.x + cv.width / 2, ty = cv.y + cv.height * 0.5;
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const swipe = async (from, to, steps = 8) => {
    await touch('touchStart', from);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from.map(([x, y], k) => [x + (to[k][0] - x) * i / steps, y + (to[k][1] - y) * i / steps]));
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(400);
  };
  const az0 = await page.evaluate(() => window.__home3d.S.viewer.controls.getAzimuthalAngle());
  await swipe([[tx, ty]], [[tx + 120, ty]]);
  const az1 = await page.evaluate(() => window.__home3d.S.viewer.controls.getAzimuthalAngle());
  check(Math.abs(az1 - az0) > 0.1, `터치 한 손가락 드래그로 시점 회전 (${az0.toFixed(2)} → ${az1.toFixed(2)})`);
  await page.click('#btnHome');
  await page.waitForTimeout(700);
  await page.evaluate(() => { const h = window.__home3d; h.startPlacement(h.createItem('armchair'), true); });
  await page.waitForTimeout(200);
  const p0 = await page.evaluate(() => ({ ...window.__home3d.S.placing.item }));
  await swipe([[tx, ty]], [[tx - 60, ty + 40]]);
  const p1 = await page.evaluate(() => ({ ...window.__home3d.S.placing.item }));
  check(p1.x !== p0.x || p1.z !== p0.z, `터치 드래그로 가구 이동 (${p0.x},${p0.z} → ${p1.x},${p1.z})`);
  const d0 = await page.evaluate(() => window.__home3d.S.viewer.camera.position.distanceTo(window.__home3d.S.viewer.controls.target));
  await swipe([[tx - 40, ty], [tx + 40, ty]], [[tx - 140, ty], [tx + 140, ty]]);
  const d1 = await page.evaluate(() => window.__home3d.S.viewer.camera.position.distanceTo(window.__home3d.S.viewer.controls.target));
  const p2 = await page.evaluate(() => ({ ...window.__home3d.S.placing.item }));
  check(d1 < d0 * 0.9, `두 손가락 벌리기로 확대 (거리 ${d0.toFixed(1)} → ${d1.toFixed(1)})`);
  check(p2.x === p1.x && p2.z === p1.z, '두 손가락 제스처 중 가구는 그대로');
  await page.click('#pbCancel');
}

// 다크 모드 · 데스크톱
const dark = await newPage({ ...mobile, colorScheme: 'dark' });
await shot(dark, 'dark-initial');
await dark.click('#toolAdd');
await dark.waitForTimeout(900);
await shot(dark, 'dark-catalog');
const desk = await newPage({ viewport: { width: 1280, height: 800 } });
await shot(desk, 'desktop');
const land = await newPage({ ...mobile, viewport: { width: 860, height: 412 } });
await shot(land, 'phone-landscape');
await land.evaluate(() => { const h = window.__home3d; h.startPlacement(h.createItem('sofaL'), true); });
await land.waitForTimeout(300);
await shot(land, 'phone-landscape-placing');

await browser.close();
check(errors.length === 0, `콘솔 오류 없음${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`);
console.log(results.join('\n'));
console.log(`screenshots: ${shots}`);
