// 카탈로그 카드·속성 미리보기용 썸네일: 실제 3D 모델을 렌더 타깃에 그려 이미지로 만든다
import * as THREE from 'three';
import { buildModel } from './models.js';
import { disposeTree } from './viewer.js';

let ctx = null;

function setup(renderer, size) {
  if (ctx && ctx.size === size) return ctx;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#a89f92', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 2.0);
  key.position.set(3, 5, 4);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
  let rt;
  try {
    rt = new THREE.WebGLRenderTarget(size, size, { samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
  } catch {
    rt = new THREE.WebGLRenderTarget(size, size);
  }
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  ctx = { scene, camera, rt, size, canvas, buf: new Uint8Array(size * size * 4) };
  return ctx;
}

const cache = new Map();

/**
 * spec: { builder, w, d, h (m), color, opts, flip }
 * 반환: data URL (실패 시 null)
 */
export function thumbnail(renderer, spec, size = 192) {
  const key = JSON.stringify([spec.builder, spec.w, spec.d, spec.h, spec.color, spec.opts, spec.flip, size]);
  if (cache.has(key)) return cache.get(key);
  let url = null;
  try {
    const c = setup(renderer, size);
    const model = buildModel(spec);
    if (spec.flip) model.scale.x = -1;
    c.scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(0.9, 0.75, 1.35).normalize();
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(c.camera.fov / 2)) * 1.02;
    c.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    c.camera.lookAt(sphere.center);
    c.camera.near = dist / 20;
    c.camera.far = dist * 4;
    c.camera.updateProjectionMatrix();

    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(c.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(c.scene, c.camera);
    renderer.readRenderTargetPixels(c.rt, 0, 0, size, size, c.buf);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);

    c.scene.remove(model);
    disposeTree(model);

    const g = c.canvas.getContext('2d');
    const img = g.createImageData(size, size);
    const row = size * 4;
    for (let y = 0; y < size; y++) img.data.set(c.buf.subarray((size - 1 - y) * row, (size - y) * row), y * row);
    g.putImageData(img, 0, 0);
    url = c.canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('thumbnail failed', err);
    url = null;
  }
  if (cache.size > 300) cache.clear();
  cache.set(key, url);
  return url;
}
