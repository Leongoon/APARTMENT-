// 렌더러 · 카메라 · 조명 · 시점 전환(3D / 평면 / 1인칭) · 필요할 때만 그리는 렌더 루프
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyCutaway } from './plan3d.js';

const EYE_HEIGHT = 1.55;

export class Viewer {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 120);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.12,
      minDistance: 1.2,
      maxDistance: 40,
      maxPolarAngle: THREE.MathUtils.degToRad(86),
      screenSpacePanning: false,
      zoomToCursor: true,
    });
    this.controls.addEventListener('change', () => this.requestRender());

    const hemi = new THREE.HemisphereLight('#ffffff', '#b7ad9f', 1.35);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff6e8', 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#e8f0ff', 0.45);
    this.scene.add(fill, fill.target);
    this.sun = sun;
    this.fill = fill;

    this.planGroup = null;
    this.planBuild = null;
    this.insets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    this.furnitureGroup = new THREE.Group();
    this.helperGroup = new THREE.Group();
    this.scene.add(this.furnitureGroup, this.helperGroup);

    this.center = new THREE.Vector3(3.2, 0, 3.9);
    this.bounds = { minX: -0.2, maxX: 6.6, minZ: -0.2, maxZ: 8.1 };
    this.view = '3d';
    this.eye = null; // 1인칭 상태 { yaw, pitch }
    this.anim = null;
    this.dirty = true;
    this.afterRender = [];
    this.raycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    if (window.ResizeObserver) new ResizeObserver(this.resize).observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setBackground(color) {
    this.scene.background = new THREE.Color(color);
    this.requestRender();
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this.requestRender();
  }

  setPlan(planBuild) {
    if (this.planGroup) {
      this.scene.remove(this.planGroup);
      disposeTree(this.planGroup);
    }
    this.planGroup = planBuild.root;
    this.planBuild = planBuild;
    this.scene.add(this.planGroup);
    this.center.copy(planBuild.center);
    this.bounds = planBuild.bounds;
    const span = Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ);
    this.sun.position.set(this.center.x - span * 0.45, span * 1.4, this.center.z + span * 0.8);
    this.sun.target.position.copy(this.center);
    const cam = this.sun.shadow.camera;
    const r = span * 0.75;
    Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: span * 4 });
    cam.updateProjectionMatrix();
    this.fill.position.set(this.center.x + span, span, this.center.z - span);
    this.fill.target.position.copy(this.center);
    this.requestRender();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (!this.eye) this.camera.fov = w / h < 1 ? 55 : 45;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    this.dirty = true;
  }

  loop(t) {
    requestAnimationFrame(this.loop);
    let changed = false;
    if (this.anim) changed = this.stepAnim(t) || changed;
    if (!this.eye && this.controls.enabled) changed = this.controls.update() || changed;
    if (changed || this.dirty) {
      this.dirty = false;
      this.updateCutaway();
      this.renderer.render(this.scene, this.camera);
      for (const fn of this.afterRender) fn();
    }
  }

  // ── 시점
  updateCutaway() {
    if (!this.planBuild) return;
    const dx = this.camera.position.x - this.controls.target.x;
    const dz = this.camera.position.z - this.controls.target.z;
    const horiz = Math.hypot(dx, dz);
    const steep = horiz < 0.35 * Math.max(0.01, this.camera.position.y - this.controls.target.y);
    applyCutaway(this.planBuild, horiz ? dx / horiz : 0, horiz ? dz / horiz : 0, steep, !this.eye);
  }

  /**
   * 도면(벽 높이 포함) 모서리 8개를 화면에 투영해, UI 막대를 뺀 영역에 꽉 차도록
   * 카메라 거리와 바라보는 점을 구한다.
   */
  computeFit(polar, azimuth) {
    const b = this.bounds;
    const h = this.planBuild ? this.planBuild.wallTop : 2.3;
    const corners = [];
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [0, h]) corners.push(new THREE.Vector3(x, y, z));
    const el = this.renderer.domElement;
    const W = el.clientWidth || 1, H = el.clientHeight || 1;
    const ins = this.insets();
    const ax0 = -1 + (2 * ins.left) / W, ax1 = 1 - (2 * ins.right) / W;
    const ay0 = -1 + (2 * ins.bottom) / H, ay1 = 1 - (2 * ins.top) / H;
    const cam = this.camera.clone();
    cam.fov = W / H < 1 ? 55 : 45;
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    const target = this.center.clone();
    const place = (d) => {
      cam.position.setFromSphericalCoords(d, Math.max(1e-4, polar), azimuth).add(target);
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
      cam.updateMatrixWorld();
    };
    const extent = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
      for (const c of corners) {
        const p = c.clone().project(cam);
        if (p.z >= 1 || p.z <= -1) behind = true;
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      return { x0, x1, y0, y1, behind };
    };
    let d = 10;
    for (let iter = 0; iter < 4; iter++) {
      let lo = 0.5, hi = 150;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        place(mid);
        const e = extent();
        const fits = !e.behind && e.x1 - e.x0 <= (ax1 - ax0) * 0.96 && e.y1 - e.y0 <= (ay1 - ay0) * 0.96;
        if (fits) hi = mid; else lo = mid;
      }
      d = hi;
      place(d);
      const e = extent();
      const dxN = (ax0 + ax1) / 2 - (e.x0 + e.x1) / 2;
      const dyN = (ay0 + ay1) / 2 - (e.y0 + e.y1) / 2;
      if (Math.abs(dxN) < 0.005 && Math.abs(dyN) < 0.005) break;
      const halfH = d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const halfW = halfH * cam.aspect;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      right.y = 0;
      right.normalize();
      const fwd = new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth));
      target.addScaledVector(right, -dxN * halfW);
      target.addScaledVector(fwd, (-dyN * halfH) / Math.max(0.35, Math.cos(polar)));
    }
    place(d);
    return { pos: cam.position.clone(), target };
  }

  setView(view, animate = true) {
    if (this.eye) this.exitEye();
    this.view = view;
    const c = this.controls;
    const polar = view === 'top' ? 0.0001 : THREE.MathUtils.degToRad(40);
    c.minPolarAngle = 0;
    c.maxPolarAngle = view === 'top' ? 0.0001 : THREE.MathUtils.degToRad(86);
    const { pos, target } = this.computeFit(polar, 0);
    this.moveCamera(pos, target, animate ? 520 : 0);
  }

  /** 현재 방향은 유지하고 특정 지점을 바라보도록 이동 */
  focusOn(x, z, distance = 5) {
    if (this.eye) return;
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(distance);
    const target = new THREE.Vector3(x, 0, z);
    this.moveCamera(target.clone().add(offset), target, 450);
  }

  moveCamera(pos, target, ms) {
    if (!ms) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.anim = {
      t0: null, ms,
      p0: this.camera.position.clone(), p1: pos,
      q0: this.controls.target.clone(), q1: target,
    };
    this.requestRender();
  }

  stepAnim(t) {
    const a = this.anim;
    if (a.t0 == null) a.t0 = t;
    const k = Math.min(1, (t - a.t0) / a.ms);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    if (this.eye) {
      this.camera.position.lerpVectors(a.p0, a.p1, e);
    } else {
      this.camera.position.lerpVectors(a.p0, a.p1, e);
      this.controls.target.lerpVectors(a.q0, a.q1, e);
      this.camera.lookAt(this.controls.target);
    }
    if (k >= 1) {
      this.anim = null;
      if (!this.eye) this.controls.update();
    }
    return true;
  }

  // ── 1인칭(눈높이)
  enterEye(x, z, yaw = 0) {
    this.eye = { yaw, pitch: -0.12, saved: { pos: this.camera.position.clone(), target: this.controls.target.clone(), view: this.view } };
    this.controls.enabled = false;
    this.anim = null;
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(x, EYE_HEIGHT, z);
    this.applyEye();
  }

  applyEye() {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.eye.pitch, this.eye.yaw, 0);
    this.requestRender();
  }

  look(dx, dy) {
    if (!this.eye) return;
    this.eye.yaw += dx * 0.0055;
    this.eye.pitch = Math.max(-1.2, Math.min(1.0, this.eye.pitch + dy * 0.0045));
    this.applyEye();
  }

  walkTo(x, z) {
    if (!this.eye) return;
    this.anim = { t0: null, ms: 650, p0: this.camera.position.clone(), p1: new THREE.Vector3(x, EYE_HEIGHT, z) };
  }

  exitEye() {
    if (!this.eye) return;
    const s = this.eye.saved;
    this.eye = null;
    this.anim = null;
    this.controls.enabled = true;
    this.resize();
    this.camera.position.copy(s.pos);
    this.controls.target.copy(s.target);
    this.camera.lookAt(s.target);
    this.controls.update();
    this.requestRender();
  }

  // ── 좌표 변환
  ndc(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** 화면 좌표 → 바닥(y=0) 위의 점 */
  floorPoint(clientX, clientY) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const p = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, p);
    if (!hit) return null;
    if (p.distanceTo(this.camera.position) > 80) return null;
    return p;
  }

  /** 화면 좌표에서 맞은 가구 id */
  pickFurniture(clientX, clientY) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hits = this.raycaster.intersectObjects(this.furnitureGroup.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.itemId) o = o.parent;
      if (o && o.visible) return o.userData.itemId;
    }
    return null;
  }

  /** 월드 좌표 → 화면 px (화면 밖/카메라 뒤면 null) */
  toScreen(v) {
    const p = v.clone().project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    const el = this.renderer.domElement;
    return { x: (p.x + 1) / 2 * el.clientWidth, y: (1 - p.y) / 2 * el.clientHeight };
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      if (!m.userData.own) continue; // 공유 캐시 재질은 유지
      if (m.userData.ownMap && m.map) m.map.dispose();
      m.dispose();
    }
  });
}
