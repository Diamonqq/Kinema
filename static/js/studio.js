/* Kinema Studio — the paper-studio renderer (DESIGN-3.0 §2).
   Clay/steel/graphite materials, technical arrows, hairline edges, drafting dimensions and angle arcs, eased cameras.
   Default (1.11.1) is a light single pass: native MSAA, tone mapping in the material shaders, one small PCF shadow.
   `{ao: true}` keeps the earlier rich path (half-float MSAA target, GTAO, VSM shadows, OutputPass) for the studio page.
   Nothing scene-specific lives here. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Kinema 1.0 is dark (owner, 2026-09-23: "definitely dark"); the paper studio stays available with <html data-theme="light">.
export const DARK = typeof document === 'undefined' || document.documentElement.dataset.theme !== 'light';
export const PALETTE = DARK ? {
  paper: 0x1B1B1B, paperEdge: 0x242424, ink: 0xD5DAE1, ink2: 0x98A1AD,
  body: 0x6F97DA, body2: 0xE0A868, body3: 0x7CC4B3, body4: 0xD98A94, static: 0x9A9384, support: 0x7F7C75, steel: 0xA3ACBA, graphite: 0x5A616B,
  weight: 0xE0605E, normal: 0x3BBF94, friction: 0xE89A3C, tension: 0x7C95F0, applied: 0xD968B8, velocity: 0x7FA7CC, omega: 0xA48BE8, highlight: 0xF5D67A,
  axes: [0xD08A55, 0x4FB39E, 0x8C9BEA],
} : {
  paper: 0xF7F4EE, paperEdge: 0xE8E4DB, ink: 0x1F2328, ink2: 0x5B6068,
  body: 0x6E8FCB, body2: 0xD9A066, body3: 0x74B3A4, body4: 0xC97B84, static: 0xB0AA9D, support: 0xA29D92, steel: 0x8E97A8, graphite: 0x33373D,
  weight: 0xC43D3D, normal: 0x1E8A6E, friction: 0xD07A1A, tension: 0x3B54C4, applied: 0xB0388A, velocity: 0x4A6C8C, omega: 0x6D4CB5, highlight: 0xF5D67A,
  axes: [0x9A5B2E, 0x2F6E62, 0x4A56A0],
};
export const FORCE_COLOR = { gravity: PALETTE.weight, normal: PALETTE.normal, friction: PALETTE.friction, joint: PALETTE.tension, applied: PALETTE.applied };
export const hex = c => '#' + c.toString(16).padStart(6, '0');
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ── materials ───────────────────────────────────────────────────────────────
export const clay = (c, o) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.78, metalness: 0, envMapIntensity: 0.35, ...(o || {}) });
export const steel = (c, o) => new THREE.MeshStandardMaterial({ color: c ?? PALETTE.steel, roughness: 0.42, metalness: 0.18, envMapIntensity: 0.7, ...(o || {}) });
export const graphite = (o) => new THREE.MeshStandardMaterial({ color: PALETTE.graphite, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.3, ...(o || {}) });
export const inkLine = (opacity, dashed) => dashed
  ? new THREE.LineDashedMaterial({ color: PALETTE.ink, transparent: true, opacity: opacity ?? 0.45, dashSize: 0.04, gapSize: 0.03, depthTest: false })
  : new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: opacity ?? 0.18, depthTest: false });
const overlayMat = (c, opacity) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0, envMapIntensity: 0.25, emissive: c, emissiveIntensity: 0.12, transparent: true, opacity: opacity ?? 0.999, depthTest: false });
export const darken = (c, k) => new THREE.Color(c).multiplyScalar(1 - (k ?? 0.35)).getHex();

/* hairline edges on a mesh — the technical-illustration cue that keeps silhouettes crisp */
export function edges(mesh, opacity, threshold) { const g = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, threshold ?? 25), inkLine(opacity ?? 0.2)); g.renderOrder = 5; mesh.add(g); return g; }

// ── colour pipeline ─────────────────────────────────────────────────────────
/* JS copies of three r170's tone curves (ShaderChunk tonemapping_pars_fragment), applied by OutputPass to
   the whole frame, background included. Linear-sRGB in, linear display out (before the sRGB encode). */
const ACES_IN = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];
const ACES_OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
const mat3 = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export function toneCurve(rgb, mapping, exposure = 1) {
  if (mapping === THREE.ACESFilmicToneMapping) {
    const v = mat3(ACES_IN, rgb.map(x => x * exposure / 0.6)).map(x => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
    return mat3(ACES_OUT, v).map(x => clamp(x, 0, 1));
  }
  if (mapping === THREE.NeutralToneMapping) {
    let c = rgb.map(x => x * exposure); const x = Math.min(...c), offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    c = c.map(v => v - offset); const peak = Math.max(...c), start = 0.8 - 0.04;
    if (peak < start) return c;
    const d = 1 - start, np = 1 - d * d / (peak + d - start), g = 1 - 1 / (0.15 * (peak - np) + 1);
    return c.map(v => v * np / peak * (1 - g) + np * g);
  }
  if (mapping === THREE.LinearToneMapping) return rgb.map(v => clamp(v * exposure, 0, 1));
  return rgb.slice();
}
/* The scene colour that the tone curve turns into `hex` on screen. Backgrounds and fog are design colours:
   without this the ACES toe turned the #14171B stage into #050607. Fixed-point solve, per channel. */
export function sceneColorFor(hex, mapping, exposure = 1) {
  const want = new THREE.Color(hex), target = [want.r, want.g, want.b];   // linear (three converts the sRGB hex)
  let x = target.slice();
  for (let k = 0; k < 60; k++) { const y = toneCurve(x, mapping, exposure); x = x.map((v, i) => Math.max(0, v + (target[i] - y[i]) * (k < 30 ? 1 : 0.5))); }
  return new THREE.Color(x[0], x[1], x[2]);
}

// ── the studio ──────────────────────────────────────────────────────────────
/* Neutral (Khronos PBR Neutral) keeps base colours and saturation up to the shoulder; ACES desaturated and
   brightened mid-tone clay toward white (teal #7CC4B3 rendered #CEE7E1). 0.8 exposure keeps lit faces near their
   base colour under the key + environment light; the background is solved through the same curve below. */
export const STUDIO_TONE = THREE.NeutralToneMapping, STUDIO_EXPOSURE = 0.8;
// Distance needed for these bounds at the user's current target and orientation. Taking the
// ratio at two viewport shapes preserves their zoom relative to the setup, including a pan.
// A resize must not turn a deliberate close view into an accidental extreme crop.
export function framingDistance(camera, target, points, width, height, insets = {}) {
  const back = camera.position.clone().sub(target).normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  const tan = Math.tan(camera.fov * Math.PI / 360);
  const fx = Math.max(.25, 1 - 2 * Math.max(insets.left || 0, insets.right || 0) / width);
  const fy = Math.max(.25, 1 - 2 * Math.max(insets.top || 0, insets.bottom || 0) / height);
  let distance = 1e-6;
  for (const point of points) {
    const p = point.clone().sub(target), depth = p.dot(back);
    distance = Math.max(distance, depth + Math.abs(p.dot(right)) / (tan * width / height * fx), depth + Math.abs(p.dot(up)) / (tan * fy));
  }
  return distance;
}
export async function makeStudio(container, opts) {
  opts = opts || {};
  const W = container.clientWidth || innerWidth, H = container.clientHeight || innerHeight;
  // An instructional diagram of a few bodies needs no post-processing: the rich path drew every frame into a
  // half-float MSAA target, ran GTAO (16+16 samples) and an OutputPass, with a 2048² VSM shadow blurred 24 times.
  const rich = opts.ao === true;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(W, H);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = rich ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
  const TONE = { aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping, linear: THREE.LinearToneMapping };
  renderer.toneMapping = TONE[opts.tone] ?? STUDIO_TONE; renderer.toneMappingExposure = opts.exposure ?? (opts.tone ? 1.0 : STUDIO_EXPOSURE); renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(opts.fov || 26, W / H, 0.02, 400);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.1; controls.maxPolarAngle = Math.PI * 0.52;
  // A neutral background and transparent shadow catcher have no finite horizon.
  // A 900-unit dome was clipped by the 400-unit camera far plane; the lit floor
  // then filled half a small diagram with a bright slab and a black edge.
  // Fog blends inside the material shaders before tone mapping, so it uses the solved colour. In the rich path the
  // OutputPass also tone-maps the background; the single pass clears to the background colour untouched.
  const paper = sceneColorFor(PALETTE.paper, renderer.toneMapping, renderer.toneMappingExposure);
  scene.background = rich ? paper : new THREE.Color(PALETTE.paper);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(600, 96), new THREE.ShadowMaterial({ color: 0x000000, opacity: DARK ? 0.16 : 0.12, depthWrite: false, fog: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.0015; floor.receiveShadow = true; scene.add(floor);
  scene.fog = new THREE.Fog(paper.clone(), 30, 200);
  const hemi = new THREE.HemisphereLight(0xFFFFFF, DARK ? 0x404650 : 0xCFC8B8, DARK ? 0.62 : 0.34); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xFFF5E6, 1.9); key.castShadow = true; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.015; scene.add(key, key.target);
  if (rich) { key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 5; key.shadow.blurSamples = 24; } else key.shadow.mapSize.set(1024, 1024);
  const fill = new THREE.DirectionalLight(0xE9F0FF, DARK ? 0.65 : 0.3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xFFFFFF, 0.2); scene.add(rim);
  // rich post: MSAA target → render → AO (if the library loads) → output (tone mapping + sRGB)
  let composer = null, ao = null;
  if (rich) {
    const target = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, target); composer.setPixelRatio(Math.min(2, devicePixelRatio)); composer.setSize(W, H);
    composer.addPass(new RenderPass(scene, camera));
    // three's own ground-truth AO (no third-party dependency; n8ao's CDN builds pull in pmndrs/postprocessing)
    try { const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js'); ao = new GTAOPass(scene, camera, W, H); ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.4, distanceExponent: 1, thickness: 1, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 }); composer.addPass(ao); }
    catch (e) { ao = null; (window.__errs = window.__errs || []).push('AO unavailable: ' + (e.message || e)); }
    composer.addPass(new OutputPass());
  }

  const cam = { from: null, to: null, t0: 0, ms: 0 };
  // A gesture takes ownership immediately, even during a preset transition.
  controls.addEventListener('start', () => { cam.to = null; });
  function moveCamera(eye, target, ms) {
    // Clear residual orbit damping before a deliberate fit/view change; otherwise the previous
    // gesture can turn the camera after the UI has already labelled it "Side".
    const damping = controls.enableDamping; controls.enableDamping = false; controls.update(); controls.enableDamping = damping;
    if (!ms) { camera.position.copy(eye); controls.target.copy(target); cam.to = null; return; }
    cam.from = { eye: camera.position.clone(), target: controls.target.clone() }; cam.to = { eye: eye.clone(), target: target.clone() }; cam.t0 = performance.now(); cam.ms = ms;
  }
  function translateCamera(delta) {
    camera.position.add(delta); controls.target.add(delta);
    // Keep an in-progress preset transition in the body's moving frame too.
    // Translating both eye and target preserves the user's orbit, pan and zoom.
    if (cam.to) for (const end of [cam.from, cam.to]) { end.eye.add(delta); end.target.add(delta); }
  }
  function tickCamera(now) {
    if (!cam.to) return; const u = clamp((now - cam.t0) / cam.ms, 0, 1); const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    camera.position.lerpVectors(cam.from.eye, cam.to.eye, e); controls.target.lerpVectors(cam.from.target, cam.to.target, e); if (u >= 1) cam.to = null;
  }
  /* World "up" for the scene being framed: y unless the builder asked for another axis just before this frame (a turntable
     drawn in a top-view plane is seen from the side with z up). Orbiting, the polar limit and the sky light follow it; the
     next frame without a request returns to y, so every other caller keeps its behaviour. */
  let upNext = null;
  let Y_UP = null;   // made on first use (tests run slices of this file without THREE)
  function setUp(v) { upNext = v ? v.clone().normalize() : null; }
  function applyUp() {
    Y_UP = Y_UP || new THREE.Vector3(0, 1, 0); const up = upNext || Y_UP; upNext = null;
    if (camera.up.equals(up)) return;
    camera.up.copy(up); hemi.position.copy(up);
    if (controls._quat) { controls._quat.setFromUnitVectors(up, Y_UP); controls._quatInverse.copy(controls._quat).invert(); }
    controls.update();
  }
  /* place lights, shadows, AO radius and fog for a scene of this centre and size; topdown turns the floor into a backdrop */
  function frame(center, size, topdown) {
    applyUp();
    if (topdown) { key.position.copy(center).add(new THREE.Vector3(-0.6, 0.8, 2.2).multiplyScalar(size)); floor.rotation.x = 0; floor.position.set(center.x, center.y, -0.35 * size); }
    else { key.position.copy(center).add(new THREE.Vector3(-0.9, 1.7, 1.1).multiplyScalar(size)); floor.rotation.x = -Math.PI / 2; floor.position.x = center.x; floor.position.z = center.z; }
    key.target.position.copy(center);
    const s = size * 1.5; key.shadow.camera.left = -s; key.shadow.camera.right = s; key.shadow.camera.top = s; key.shadow.camera.bottom = -s; key.shadow.camera.near = Math.max(size * 0.01, 1e-5); key.shadow.camera.far = size * 9; key.shadow.camera.updateProjectionMatrix();
    key.shadow.normalBias = size * 0.003;
    camera.near = Math.max(size * 0.002, 1e-5); camera.far = Math.max(size * 80, 20); camera.updateProjectionMatrix();
    controls.minDistance = size * 0.15; controls.maxDistance = size * 30;
    fill.position.copy(center).add(new THREE.Vector3(1.4, 0.6, 1.3).multiplyScalar(size));
    rim.position.copy(center).add(new THREE.Vector3(0.6, 0.9, -1.5).multiplyScalar(size));
    scene.fog.near = 6 * size + 4; scene.fog.far = 40 * size + 40;
    if (ao) { ao.updateGtaoMaterial({ radius: clamp(0.16 * size, 0.001, 2.5) }); }
  }
  function setFloorY(y) { floor.position.y = (y || 0) - 0.0015; }
  const resizeListeners = new Set();
  function onResize(fn) { resizeListeners.add(fn); return () => resizeListeners.delete(fn); }
  let renderedWidth = W, renderedHeight = H;
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    // Docking parks the stage briefly. Keep the last real viewport instead of fitting it to
    // the browser window while hidden, then compensating from that unrelated aspect.
    if (!(w > 0 && h > 0) || (w === renderedWidth && h === renderedHeight)) return;
    const frame = opts.resizeFrame?.(), previous = camera.aspect;
    if (frame?.points?.length) {
      const target = controls.target, offset = camera.position.clone().sub(target);
      const before = framingDistance(camera, target, frame.points, renderedWidth, renderedHeight, frame.insets);
      const after = framingDistance(camera, target, frame.points, w, h, frame.insets);
      const distance = clamp(Math.sqrt(offset.lengthSq()) * after / before, controls.minDistance, controls.maxDistance);
      moveCamera(target.clone().add(offset.normalize().multiplyScalar(distance)), target, 0);
    }
    renderedWidth = w; renderedHeight = h;
    renderer.setSize(w, h); if (composer) composer.setSize(w, h); if (ao) ao.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (previous !== camera.aspect) for (const fn of resizeListeners) fn(previous);
  }
  addEventListener('resize', resize);
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  ray.params.Line.threshold = 0.001; ray.params.Points.threshold = 0.001;   // hairline edges must never win a pick (the default threshold is ONE METRE)
  function pick(clientX, clientY, objects) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); const hits = ray.intersectObjects(objects, true).filter(h => h.object.isMesh); return hits.length ? hits[0] : null; }
  function render(now) { tickCamera(now || performance.now()); controls.update(); if (composer) composer.render(); else renderer.render(scene, camera); }
  return { renderer, scene, camera, controls, composer, ao, quality: rich ? 'rich' : 'light', floor, lights: { key, fill, rim, hemi }, frame, setUp, setFloorY, moveCamera, translateCamera, resize, onResize, pick, render };
}

// ── technical arrows ────────────────────────────────────────────────────────
/* A slim vector: shaft radius r, head 2.6 r wide and 7 r long. Overlay (never hidden inside a body). update(from, dir, len). */
export class Arrow3D {
  constructor(scene, color, r, opts) {
    opts = opts || {}; this.r = r || 0.008; this.g = new THREE.Group(); this.g.renderOrder = 30;
    this.mat = overlayMat(color, opts.opacity);
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18), this.mat); this.shaft.renderOrder = 30;
    this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 22), this.mat); this.head.renderOrder = 30;
    this.g.add(this.shaft, this.head); scene.add(this.g); this.g.visible = false; this.tip = new THREE.Vector3(); this.from = new THREE.Vector3();
  }
  update(from, dir, len) {
    this.from.copy(from); this.tip.copy(from).add(dir.clone().normalize().multiplyScalar(len || 0));
    if (!(len > 1e-6)) { this.g.visible = false; return; }
    this.g.visible = true; const r = this.r, hl = Math.min(7 * r, len * 0.45), sl = len - hl;
    this.shaft.scale.set(r, sl, r); this.shaft.position.y = sl / 2; this.head.scale.set(2.6 * r, hl, 2.6 * r); this.head.position.y = sl + hl / 2;
    this.g.position.copy(from); this.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  }
  setColor(c) { this.mat.color.set(c); this.mat.emissive.set(c); }
  setOpacity(o) { this.mat.opacity = o; }
  dispose() { this.g.parent && this.g.parent.remove(this.g); }
}

// ── drafting: dimensions, angles, right angles ──────────────────────────────
function mkLine(pts, mat) { const g = new THREE.BufferGeometry().setFromPoints(pts); const l = new THREE.Line(g, mat); if (mat.isLineDashedMaterial) l.computeLineDistances(); l.renderOrder = 26; return l; }
function line(scene, pts, mat) { const l = mkLine(pts, mat); scene.add(l); return l; }
/* A length dimension between p1 and p2, drawn offset by `off` (a vector) with extension lines and end ticks. Returns {group, mid}. */
export function dimension(scene, p1, p2, off, opts) {
  opts = opts || {}; const group = new THREE.Group(); scene.add(group);
  const a = p1.clone().add(off), b = p2.clone().add(off); const dir = b.clone().sub(a).normalize(); const tick = off.clone().normalize().multiplyScalar(opts.tick ?? 0.035);
  const solid = inkLine(opts.opacity ?? 0.6), dashed = inkLine((opts.opacity ?? 0.6) * 0.7, true);
  group.add(mkLine([p1, a.clone().add(tick)], dashed), mkLine([p2, b.clone().add(tick)], dashed), mkLine([a, b], solid));
  const t45 = dir.clone().add(off.clone().normalize()).normalize().multiplyScalar((opts.tick ?? 0.035) * 0.9);
  group.add(mkLine([a.clone().sub(t45), a.clone().add(t45)], solid), mkLine([b.clone().sub(t45), b.clone().add(t45)], solid));
  return { group, mid: a.clone().add(b).multiplyScalar(0.5), dispose: () => scene.remove(group) };
}
/* An angle arc at `center` from angle a0 to a1 (radians, in the XY plane, z = center.z). Returns {group, label: point at the bisector}. */
export function angleArc(scene, center, r, a0, a1, opts) {
  opts = opts || {}; const pts = []; const n = 40; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; pts.push(center.clone().add(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0))); }
  const l = line(scene, pts, inkLine(opts.opacity ?? 0.6)); const mid = (a0 + a1) / 2;
  return { group: l, label: center.clone().add(new THREE.Vector3(Math.cos(mid) * r * 1.35, Math.sin(mid) * r * 1.35, 0)), dispose: () => scene.remove(l) };
}
/* The small square that marks a right angle at `corner` between unit directions u and v. */
export function rightAngle(scene, corner, u, v, s) {
  s = s || 0.05; const a = corner.clone().add(u.clone().multiplyScalar(s)), b = corner.clone().add(u.clone().multiplyScalar(s)).add(v.clone().multiplyScalar(s)), c = corner.clone().add(v.clone().multiplyScalar(s));
  const l = line(scene, [a, b, c], inkLine(0.55)); return { group: l, dispose: () => scene.remove(l) };
}
/* A dotted projection line (the "shadow" of a vector tip onto an axis). */
export function projectionLine(scene, from, to, opts) { const l = line(scene, [from, to], inkLine((opts && opts.opacity) ?? 0.5, true)); return { group: l, dispose: () => scene.remove(l) }; }

// ── a fading trail of a point ───────────────────────────────────────────────
export class Trail {
  constructor(scene, color, max) { this.max = max || 240; this.pts = []; this.geo = new THREE.BufferGeometry(); this.pos = new Float32Array(this.max * 3); this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); this.geo.setDrawRange(0, 0); this.line = new THREE.Line(this.geo, new THREE.LineBasicMaterial({ color: color ?? PALETTE.ink, transparent: true, opacity: 0.32, depthTest: false })); this.line.renderOrder = 24; scene.add(this.line); this.last = null; }
  push(p) { if (this.last && this.last.distanceToSquared(p) < 1e-6) return; this.last = p.clone(); this.pts.push(this.last); if (this.pts.length > this.max) this.pts.shift(); for (let i = 0; i < this.pts.length; i++) { this.pos[3 * i] = this.pts[i].x; this.pos[3 * i + 1] = this.pts[i].y; this.pos[3 * i + 2] = this.pts[i].z; } this.geo.attributes.position.needsUpdate = true; this.geo.setDrawRange(0, this.pts.length); }
  clear() { this.pts = []; this.last = null; this.geo.setDrawRange(0, 0); }
  set visible(v) { this.line.visible = v; }
}

// Keep preferred ring/pin positions, then search a small neighbourhood for room.
// Boxes use centre coordinates; viewport bounds already exclude the outer gutter.
// A box may carry `last`, the offset it used on the previous frame; keeping that offset
// unless it now collides stops labels flipping sides from one frame to the next.
export function arrangeCalloutBoxes(boxes, viewport, obstacles = []) {
  const placed = obstacles.slice(), result = [];
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)) * Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
  const crosses = (start, end, box) => {
    if (!start) return false;
    let lo = 0, hi = 1;
    for (let axis = 0; axis < 2; axis++) {
      const delta = end[axis] - start[axis], mid = axis ? box.y : box.x, half = (axis ? box.h : box.w) / 2;
      if (Math.abs(delta) < 1e-8) { if (start[axis] < mid - half || start[axis] > mid + half) return false; }
      else { let a = (mid - half - start[axis]) / delta, b = (mid + half - start[axis]) / delta; if (a > b) [a, b] = [b, a]; lo = Math.max(lo, a); hi = Math.min(hi, b); if (lo > hi) return false; }
    }
    return true;
  };
  for (const box of boxes) {
    const left = viewport.left + box.w / 2, right = viewport.right - box.w / 2;
    const top = viewport.top + box.h / 2, bottom = viewport.bottom - box.h / 2;
    const step = Math.max(20, Math.min(42, box.h + 6));
    const candidates = [[0, 0]];
    if (box.last) candidates.push(box.last);
    for (let ring = 1; ring <= 6; ring++) for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]) candidates.push([dx * ring * step, dy * ring * step]);
    let best = null;
    for (const [dx, dy] of candidates) {
      const candidate = { ...box, x: left <= right ? clamp(box.x + dx, left, right) : (viewport.left + viewport.right) / 2, y: top <= bottom ? clamp(box.y + dy, top, bottom) : (viewport.top + viewport.bottom) / 2 };
      const area = placed.reduce((sum, other) => sum + overlap(candidate, other), 0);
      const leaders = placed.reduce((sum, other) => sum + (crosses(box.anchor, [candidate.x, candidate.y], other) ? 1 : 0), 0);
      const distance = (candidate.x - box.x) ** 2 + (candidate.y - box.y) ** 2;
      const moved = box.last ? (candidate.x - box.x - box.last[0]) ** 2 + (candidate.y - box.y - box.last[1]) ** 2 : 0;
      const score = distance + 0.6 * moved + leaders * step * step * 3;
      if (!best || area < best.area - 1e-6 || (Math.abs(area - best.area) <= 1e-6 && score < best.score)) best = { candidate, area, score };
    }
    result.push(best.candidate); placed.push(best.candidate);
  }
  return result;
}

// ── screen-space callouts (labels on a ring outside the focus, hairline leaders) ─
/* Ring angle for a label whose anchor sits (dx, dy) px from the focus: its preferred angle, leaning
   toward the anchor's direction by 0.5·sin(difference). The lean is periodic, so it is continuous for every
   anchor direction (a plain blend jumps when the anchor crosses the side opposite the preference), and it
   fades in over the first 40 px so an anchor passing through the focus does not swing the label either. */
export function calloutAngle(dx, dy, prefer) {
  const d = Math.hypot(dx, dy);
  if (!(d > 0)) return prefer;
  return prefer + 0.5 * Math.min(1, d / 40) * Math.sin(Math.atan2(dy, dx) - prefer);
}
/* Exponential approach toward a target over wall-clock time; tau in seconds. */
export function easeToward(from, to, dt, tau) { const k = 1 - Math.exp(-Math.max(0, dt) / tau); return from + (to - from) * k; }

export class Callouts {
  constructor(host, svg, camera) { this.host = host; this.svg = svg; this.camera = camera; this.items = []; this.v = new THREE.Vector3(); this.lastTime = null; }
  add(html, color, prefer) {
    const el = document.createElement('div'); el.className = 'co'; el.innerHTML = `<i style="background:${color}"></i>` + html;
    // Equal-width digits: a changing value must not change the chip's width every frame.
    el.style.fontVariantNumeric = 'tabular-nums';
    if (window.renderMathInElement) renderMathInElement(el, { delimiters: [{ left: '$', right: '$', display: false }], throwOnError: false });
    this.host.appendChild(el);
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ln.setAttribute('stroke', hex(PALETTE.ink)); ln.setAttribute('stroke-width', '1'); ln.setAttribute('stroke-opacity', '0.5');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '2.2'); dot.setAttribute('fill', color);
    this.svg.appendChild(ln); this.svg.appendChild(dot);
    const it = { el, ln, dot, prefer: (prefer || 0) * Math.PI / 180, anchor: new THREE.Vector3(), on: true, pin: null, shown: null, last: null, rank: null }; this.items.push(it); return it;
  }
  screen(p, W, H) { this.v.copy(p).project(this.camera); return [(this.v.x + 1) / 2 * W, (1 - this.v.y) / 2 * H]; }
  /* now (ms, optional): the frame time. Label boxes glide (about 0.1 s) to their new place instead of
     snapping; leaders and dots always follow the anchors exactly. */
  layout(focus, radiusWorld, W, H, now) {
    now = now ?? performance.now();
    const dt = this.lastTime == null ? Infinity : (now - this.lastTime) / 1000; this.lastTime = now;
    const c = this.screen(focus, W, H); const e = this.screen(focus.clone().add(new THREE.Vector3(0, radiusWorld, 0)), W, H);
    const rpx = Math.hypot(e[0] - c[0], e[1] - c[1]); const rad = rpx + 64;
    for (const i of this.items) { const vis = i.on ? '' : 'none'; i.el.style.display = vis; i.ln.style.display = vis; i.dot.style.display = vis; if (!i.on) { i.shown = null; i.last = null; i.rank = null; } }
    const live = this.items.filter(i => i.on && !i.pin);
    const arr = live.map(i => { const p = this.screen(i.anchor, W, H); return { i, p, ang: calloutAngle(p[0] - c[0], p[1] - c[1], i.prefer) }; });
    const ring = arr.slice().sort((a, b) => a.ang - b.ang);
    const minSep = 26 * Math.PI / 180;
    // Keep last frame's order for neighbours still within the spacing: when two anchors' angles cross,
    // swapping order flips both labels to opposite sides of each other (a ~minSep * radius jump).
    for (let k = 0; k < ring.length; k++) for (let j = 1; j < ring.length; j++) {
      const a = ring[j - 1], b = ring[j];
      if (a.i.rank != null && b.i.rank != null && a.i.rank > b.i.rank && b.ang - a.ang < minSep) { ring[j - 1] = b; ring[j] = a; }
    }
    ring.forEach((a, k) => { a.i.rank = k; });
    for (let k = 0; k < 14; k++) for (let j = 1; j < ring.length; j++) { const d = ring[j].ang - ring[j - 1].ang; if (d < minSep) { const push = (minSep - d) / 2; ring[j - 1].ang -= push; ring[j].ang += push; } }
    const requests = [];
    // Reserve pinned drafting/tension labels first, so force labels make room for them.
    for (const i of this.items) if (i.on && i.pin) { const p = this.screen(i.anchor, W, H); const q = this.screen(i.pin, W, H); requests.push({ i, p, x: q[0], y: q[1] }); }
    // Then the ring labels in their fixed item order: a changing angular order must not reshuffle who gets room first.
    for (const a of arr) requests.push({ ...a, x: c[0] + rad * Math.cos(a.ang), y: c[1] + rad * Math.sin(a.ang) });
    const stage = this.host.parentElement, bounds = this.host.getBoundingClientRect(), obstacles = [];
    for (const el of stage?.querySelectorAll('.stitle, .transport, .hint, .stagehint, .inspector, .readout, .overlays, .energy') || []) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) obstacles.push({ x: r.left - bounds.left + r.width / 2, y: r.top - bounds.top + r.height / 2, w: r.width + 16, h: r.height + 16 });
    }
    // Marks a view needs to stay readable (a point-mass bead), published on the shared camera as world points and
    // radii; labels go around them as around controls.
    for (const k of this.camera.userData.keepClear || []) {
      const c = this.screen(k.p, W, H), e = this.screen(k.p.clone().add(new THREE.Vector3(0, k.r, 0)), W, H), r = Math.hypot(e[0] - c[0], e[1] - c[1]) + 3;
      if (c.every(Number.isFinite)) obstacles.push({ x: c[0], y: c[1], w: 2 * r + 16, h: 2 * r + 16 });
    }
    // A crowded stage carries symbol-only chips for quantities that are not being explained: the value stays in
    // the readout, while the highlighted (current) quantity and pinned/drafting labels keep theirs. Crowding is the
    // full chips' area over the free stage area, with hysteresis, so values do not flicker in and out in playback.
    const parts = requests.map(r => [r, r.i.el.querySelectorAll(':scope > b, :scope > small')]);
    for (const [, list] of parts) for (const part of list) part.style.display = '';
    let used = 0; for (const r of requests) used += (r.i.el.offsetWidth + 8) * (r.i.el.offsetHeight + 8);
    const free = Math.max(1, (W - 24) * (H - 24) - obstacles.reduce((sum, o) => sum + o.w * o.h, 0));
    this.crowding = used / free; this.compact = this.crowding > (this.compact ? 0.06 : 0.08);
    for (const [r, list] of parts) {
      const el = r.i.el, terse = this.compact && !r.i.pin && !['hl', 'plain', 'formula'].some(c => el.classList.contains(c));
      for (const part of list) part.style.display = terse ? 'none' : '';
    }
    for (const request of requests) {
      const s = request.i.el.style;
      // One line when it fits; wrap only when the chip is wider than the whole stage.
      s.width = 'max-content'; s.maxWidth = Math.max(24, W - 36) + 'px'; s.whiteSpace = 'normal'; s.overflowWrap = 'anywhere';
      // Reserve a slightly rounded-up size so a width change of a pixel or two does not move neighbours.
      request.w = Math.ceil((request.i.el.offsetWidth + 8) / 12) * 12; request.h = request.i.el.offsetHeight + 8; request.anchor = request.p; request.last = request.i.last;
    }
    const positions = arrangeCalloutBoxes(requests, { left: 12, top: 12, right: W - 12, bottom: H - 12 }, obstacles);
    // Glide only between consecutive animation frames; a first or long-delayed layout snaps.
    const glide = positions.map((position, index) => { const i = requests[index].i;
      return !i.shown || !(dt < 0.25) ? [position.x, position.y] : [easeToward(i.shown[0], position.x, dt, 0.09), easeToward(i.shown[1], position.y, dt, 0.09)]; });
    // A gliding box may never cover another label or a control that its target position clears: such boxes
    // snap to the target instead. Snapping only ever returns to the arranged layout, so this terminates.
    const hit = (a, b) => Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2) > 0.5 && Math.min(a[1] + a[3] / 2, b[1] + b[3] / 2) - Math.max(a[1] - a[3] / 2, b[1] - b[3] / 2) > 0.5;
    const box = (index, at) => [at[0], at[1], requests[index].w - 8, requests[index].h - 8];
    const obs = obstacles.map(o => [o.x, o.y, o.w - 16, o.h - 16]);
    for (let pass = 0; pass < positions.length + 1; pass++) {
      let changed = false;
      for (let a = 0; a < positions.length; a++) {
        const target = [positions[a].x, positions[a].y];
        if (glide[a][0] === target[0] && glide[a][1] === target[1]) continue;
        const now = box(a, glide[a]), goal = box(a, target);
        const bad = obs.some(o => hit(now, o) && !hit(goal, o)) || positions.some((p, b) => b !== a && hit(now, box(b, glide[b])) && !hit(goal, box(b, [p.x, p.y])));
        if (bad) { glide[a] = target; changed = true; }
      }
      if (!changed) break;
    }
    positions.forEach((position, index) => {
      const request = requests[index], i = request.i;
      i.last = [position.x - request.x, position.y - request.y];
      // A displaced drafting label needs a leader even if its usual pinned label did not.
      i.ln.style.stroke = i.el.classList.contains('plain') && Math.hypot(position.x - request.x, position.y - request.y) > 6 ? hex(PALETTE.ink) : '';
      i.shown = glide[index];
      this.place(i, i.shown[0], i.shown[1], request.p);
    });
  }
  place(i, lx, ly, p) {
    i.el.style.left = lx + 'px'; i.el.style.top = ly + 'px';
    const bw = i.el.offsetWidth / 2 + 2, bh = i.el.offsetHeight / 2 + 2; const dx = p[0] - lx, dy = p[1] - ly; const m = Math.max(1e-6, Math.hypot(dx, dy)); const ux = dx / m, uy = dy / m;
    const t = Math.min(bw / Math.max(Math.abs(ux), 1e-6), bh / Math.max(Math.abs(uy), 1e-6));
    i.ln.setAttribute('x1', lx + ux * t); i.ln.setAttribute('y1', ly + uy * t); i.ln.setAttribute('x2', p[0]); i.ln.setAttribute('y2', p[1]); i.dot.setAttribute('cx', p[0]); i.dot.setAttribute('cy', p[1]);
  }
  clear() { for (const i of this.items) { i.el.remove(); i.ln.remove(); i.dot.remove(); } this.items = []; }
}
