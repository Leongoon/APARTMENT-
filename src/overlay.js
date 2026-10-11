// 선택·배치 중인 가구의 바닥 윤곽선, 벽·가구까지 거리(줄자) 선과 cm 라벨
import * as THREE from 'three';
import { obbCorners } from './geom2d.js';

const Y_LINE = 0.03;

export class Overlay {
  constructor(viewer, labelsEl) {
    this.viewer = viewer;
    this.labelsEl = labelsEl;
    this.colors = { accent: '#2648b8', warn: '#c84a1f', tape: '#f3c22c' };

    const outlineGeo = new THREE.BufferGeometry();
    outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(5 * 3), 3));
    this.outline = new THREE.Line(outlineGeo, new THREE.LineBasicMaterial({ color: this.colors.accent, depthTest: false, transparent: true, opacity: 0.95 }));
    this.outline.renderOrder = 20;
    this.outline.frustumCulled = false;

    const fillGeo = new THREE.PlaneGeometry(1, 1);
    fillGeo.rotateX(-Math.PI / 2);
    this.fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: this.colors.accent, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.fill.renderOrder = 2;

    const measureGeo = new THREE.BufferGeometry();
    measureGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 6 * 3), 3));
    this.measure = new THREE.LineSegments(measureGeo, new THREE.LineBasicMaterial({ color: this.colors.tape, depthTest: false, transparent: true }));
    this.measure.renderOrder = 21;
    this.measure.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.add(this.fill, this.outline, this.measure);
    this.group.visible = false;
    viewer.helperGroup.add(this.group);

    this.distTags = [0, 1, 2, 3].map(() => this.makeTag('tag'));
    this.anchors = []; // [{ el, pos: Vector3 }]
    viewer.afterRender.push(() => this.updateTags());
  }

  makeTag(cls) {
    const el = document.createElement('div');
    el.className = cls;
    el.hidden = true;
    this.labelsEl.appendChild(el);
    return el;
  }

  setColors(c) {
    Object.assign(this.colors, c);
    this.measure.material.color.set(this.colors.tape);
  }

  /**
   * obb: m 단위 가구 바닥 사각형, bad: 겹침 여부, clearances: measureClearances 결과(m)
   */
  show(obb, bad, clearances) {
    const color = bad ? this.colors.warn : this.colors.accent;
    this.outline.material.color.set(color);
    this.fill.material.color.set(color);
    const pts = obbCorners(obb);
    const pos = this.outline.geometry.attributes.position;
    for (let i = 0; i < 5; i++) {
      const [x, z] = pts[i % 4];
      pos.setXYZ(i, x, Y_LINE, z);
    }
    pos.needsUpdate = true;
    this.outline.geometry.computeBoundingSphere();
    this.fill.position.set(obb.cx, 0.004, obb.cz);
    this.fill.rotation.y = obb.angle;
    this.fill.scale.set(obb.hw * 2 + 0.06, 1, obb.hd * 2 + 0.06);

    this.anchors = [];
    const mpos = this.measure.geometry.attributes.position;
    let n = 0;
    const put = (x, z) => { mpos.setXYZ(n++, x, Y_LINE, z); };
    let ti = 0;
    for (const key of ['left', 'right', 'up', 'down']) {
      const c = clearances && clearances[key];
      if (!c || c.dist < 0.005) continue;
      const [ax, az] = c.a, [bx, bz] = c.b;
      put(ax, az); put(bx, bz);
      // 양 끝 눈금
      const horizontal = Math.abs(bx - ax) > Math.abs(bz - az);
      const t = 0.05;
      for (const [x, z] of [[ax, az], [bx, bz]]) {
        if (horizontal) { put(x, z - t); put(x, z + t); } else { put(x - t, z); put(x + t, z); }
      }
      const el = this.distTags[ti++];
      el.textContent = `${Math.round(c.dist * 100)}`;
      this.anchors.push({ el, pos: new THREE.Vector3((ax + bx) / 2, Y_LINE, (az + bz) / 2) });
    }
    for (let i = n; i < mpos.count; i++) mpos.setXYZ(i, 0, -10, 0);
    mpos.needsUpdate = true;
    this.measure.geometry.setDrawRange(0, n);
    this.measure.visible = n > 0;
    for (let i = ti; i < this.distTags.length; i++) this.distTags[i].hidden = true;

    this.group.visible = true;
    this.viewer.requestRender();
  }

  hide() {
    this.group.visible = false;
    this.anchors = [];
    for (const t of this.distTags) t.hidden = true;
    this.viewer.requestRender();
  }

  updateTags() {
    if (!this.group.visible) return;
    for (const { el, pos } of this.anchors) {
      const s = this.viewer.toScreen(pos);
      if (!s) { el.hidden = true; continue; }
      el.hidden = false;
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
}

export function fmt(cm) {
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1);
}
