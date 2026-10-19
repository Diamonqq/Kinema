/* Kinema world3d — the 3D renderer for the tested 2D physics.
   The physics (frames, forces, quantities) comes from engine.js templates; this file only builds
   meshes and moves them. Every scene builder returns {update(p, frame), bounds, focus(frame)}.
   Geometry is checked, not eyeballed: builders expose check(p, frame) → {name: error metres}. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const PALETTE = { body: 0x5b7cff, bodyDark: 0x3f5be0, slab: 0x1c212c, slabTop: 0x252b39, floor: 0x0f1218,
  mg: 0xff5d5d, N: 0x45d483, f: 0xffb547, v: 0x7db2ff, omega: 0xc4a3ff, tau: 0xff9f43, T: 0xffb547, pivot: 0x45d483, P: 0xff7ab6 };

export function makeStage(container, opts) {
  opts = opts || {};
  const W = container.clientWidth || innerWidth, H = container.clientHeight || innerHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(W, H);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(opts.fov || 32, W / H, 0.02, 200);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;
  // studio: a soft floor, warm key with soft shadows, cool rim, hemisphere fill
  const fc = document.createElement('canvas'); fc.width = fc.height = 1024; const fx = fc.getContext('2d');
  const grad = fx.createRadialGradient(512, 512, 40, 512, 512, 520); grad.addColorStop(0, '#1b1f2a'); grad.addColorStop(0.6, '#10131b'); grad.addColorStop(1, '#090b11'); fx.fillStyle = grad; fx.fillRect(0, 0, 1024, 1024);
  const floorTex = new THREE.CanvasTexture(fc); floorTex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 128), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1, metalness: 0, envMapIntensity: 0.08 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.0015; floor.receiveShadow = true; scene.add(floor);
  scene.add(new THREE.HemisphereLight(0x9fb0ff, 0x0b0d14, 0.32));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.9); key.castShadow = true; key.shadow.mapSize.set(4096, 4096); key.shadow.bias = -0.00025; key.shadow.normalBias = 0.02; key.shadow.radius = 3; scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x7da2ff, 0.55); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25); scene.add(fill);
  function frameLights(center, size, topdown) {
    if (topdown) {   // the scene lies in the XY plane seen along −z: the floor becomes a backdrop behind it, the key light comes from the viewer's side
      key.position.copy(center).add(new THREE.Vector3(-0.7, 0.9, 2.2).multiplyScalar(size)); floor.rotation.x = 0; floor.position.set(center.x, center.y, -0.35 * size);
    } else { key.position.copy(center).add(new THREE.Vector3(-1.1, 2.2, 1.4).multiplyScalar(size)); floor.rotation.x = -Math.PI / 2; floor.position.x = center.x; floor.position.z = center.z; }
    key.target.position.copy(center);
    const s = size * 1.4; key.shadow.camera.left = -s; key.shadow.camera.right = s; key.shadow.camera.top = s; key.shadow.camera.bottom = -s; key.shadow.camera.near = 0.1; key.shadow.camera.far = size * 8; key.shadow.camera.updateProjectionMatrix();
    rim.position.copy(center).add(new THREE.Vector3(0.8, 0.9, -1.6).multiplyScalar(size));
    fill.position.copy(center).add(new THREE.Vector3(1.6, 0.6, 1.2).multiplyScalar(size));
  }
  function setFloorY(y) { floor.position.y = (y || 0) - 0.0015; }   // the studio floor must sit at the scene's lowest point, not at y = 0
  function resize() { const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize);
  return { renderer, scene, camera, controls, frameLights, setFloorY, resize, W, H };
}

// ── materials ──────────────────────────────────────────────────────────────
export const matte = (c, o) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0, envMapIntensity: 0.15, ...(o || {}) });
export const satin = (c, o) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, metalness: 0.02, envMapIntensity: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35, ...(o || {}) });
function overlayMat(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0, emissive: c, emissiveIntensity: 0.22, envMapIntensity: 0.3, transparent: true, opacity: 0.999, depthTest: false }); }

/* A slim vector: shaft radius r, head 3r wide and 7r long, drawn as an overlay (never hidden by bodies).
   update(from, dir, len) repositions it; len 0 hides it. */
export class Arrow {
  constructor(scene, color, r) {
    this.r = r || 0.011; this.g = new THREE.Group(); this.g.renderOrder = 30;
    const m = overlayMat(color);
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20), m); this.shaft.castShadow = true; this.shaft.renderOrder = 30;
    this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24), m); this.head.castShadow = true; this.head.renderOrder = 30;
    this.g.add(this.shaft, this.head); scene.add(this.g); this.g.visible = false;
  }
  update(from, dir, len) {
    this.tip = from.clone().add(dir.clone().normalize().multiplyScalar(len || 0));
    if (!(len > 1e-6)) { this.g.visible = false; return; }
    this.g.visible = true; const r = this.r, hl = Math.min(7 * r, len * 0.45), sl = len - hl;
    this.shaft.scale.set(r, sl, r); this.shaft.position.y = sl / 2;
    this.head.scale.set(3 * r, hl, 3 * r); this.head.position.y = sl + hl / 2;
    this.g.position.copy(from); this.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  }
}

/* Screen-space callouts: a label per anchor, laid out on a ring around a focus point, leader lines in SVG. */
export class Callouts {
  constructor(host, svg, camera) { this.host = host; this.svg = svg; this.camera = camera; this.items = []; this.v = new THREE.Vector3(); }
  add(html, color, prefer) {
    const el = document.createElement('div'); el.className = 'co'; el.innerHTML = `<i style="background:${color}"></i>` + html;
    if (window.renderMathInElement) renderMathInElement(el, { delimiters: [{ left: '$', right: '$', display: false }], throwOnError: false });
    this.host.appendChild(el);
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ln.setAttribute('stroke', color); ln.setAttribute('stroke-width', '1.1'); ln.setAttribute('stroke-opacity', '0.7');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '2.4'); dot.setAttribute('fill', color);
    this.svg.appendChild(ln); this.svg.appendChild(dot);
    const it = { el, ln, dot, prefer: (prefer || 0) * Math.PI / 180, anchor: new THREE.Vector3(), on: true }; this.items.push(it); return it;
  }
  screen(p, W, H) { this.v.copy(p).project(this.camera); return [(this.v.x + 1) / 2 * W, (1 - this.v.y) / 2 * H]; }
  layout(focus, radiusWorld, W, H) {
    const c = this.screen(focus, W, H); const e = this.screen(focus.clone().add(new THREE.Vector3(0, radiusWorld, 0)), W, H);
    const rpx = Math.hypot(e[0] - c[0], e[1] - c[1]); const rad = rpx + 58;
    const live = this.items.filter(i => i.on);
    for (const i of this.items) { const vis = i.on ? '' : 'none'; i.el.style.display = vis; i.ln.style.display = vis; i.dot.style.display = vis; }
    const arr = live.map(i => { const p = this.screen(i.anchor, W, H); const d = Math.hypot(p[0] - c[0], p[1] - c[1]); const a0 = d < 4 ? i.prefer : Math.atan2(p[1] - c[1], p[0] - c[0]); return { i, p, ang: 0.4 * a0 + 0.6 * i.prefer }; });
    arr.sort((a, b) => a.ang - b.ang);
    const minSep = 24 * Math.PI / 180;
    for (let k = 0; k < 14; k++) for (let j = 1; j < arr.length; j++) { const d = arr[j].ang - arr[j - 1].ang; if (d < minSep) { const push = (minSep - d) / 2; arr[j - 1].ang -= push; arr[j].ang += push; } }
    for (const a of arr) {
      const lx = c[0] + rad * Math.cos(a.ang), ly = c[1] + rad * Math.sin(a.ang);
      a.i.el.style.left = lx + 'px'; a.i.el.style.top = ly + 'px';
      const bw = a.i.el.offsetWidth / 2 + 2, bh = a.i.el.offsetHeight / 2 + 2;
      const dx = a.p[0] - lx, dy = a.p[1] - ly; const m = Math.max(1e-6, Math.hypot(dx, dy)); const ux = dx / m, uy = dy / m;
      const t = Math.min(bw / Math.max(Math.abs(ux), 1e-6), bh / Math.max(Math.abs(uy), 1e-6));   // exit point on the label's box
      a.i.ln.setAttribute('x1', lx + ux * t); a.i.ln.setAttribute('y1', ly + uy * t); a.i.ln.setAttribute('x2', a.p[0]); a.i.ln.setAttribute('y2', a.p[1]);
      a.i.dot.setAttribute('cx', a.p[0]); a.i.dot.setAttribute('cy', a.p[1]);
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
export function slab(scene, profile2d, width, mat) {
  // profile2d: array of [x,y] in the XY plane (counter-clockwise), extruded symmetrically along z
  const shape = new THREE.Shape(); profile2d.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4 });
  const m = new THREE.Mesh(geo, mat || matte(0x2b3241, { roughness: 0.78, envMapIntensity: 0.25 })); m.position.z = -width / 2; m.castShadow = true; m.receiveShadow = true; scene.add(m); return m;
}
export function ball(scene, R, color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), satin(color || PALETTE.body)); body.castShadow = true; body.receiveShadow = true; g.add(body);
  // spin cues: two thin great-circle rings + a small dot, so rolling reads without a texture
  const ringM = matte(0xf4f5f7, { roughness: 0.6 });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(R * 1.001, R * 0.012, 10, 128), ringM); g.add(r1);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(R * 1.001, R * 0.012, 10, 128), ringM); r2.rotation.x = Math.PI / 2; g.add(r2);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.06, 16, 16), matte(0xf4f5f7)); dot.position.set(0, R * 0.98, 0); g.add(dot);
  scene.add(g); return g;
}
export function marker(scene, r, color) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 20), overlayMat(color || 0xffffff)); m.renderOrder = 31; scene.add(m); return m; }
export function angleArc(scene, center, r, a0, a1, color, plane) {
  const pts = []; for (let i = 0; i <= 40; i++) { const t = a0 + (a1 - a0) * i / 40; pts.push(center.clone().add(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0))); }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: color || 0xa3a7b3, transparent: true, opacity: 0.9, depthTest: false })); l.renderOrder = 29; scene.add(l); return l;
}

// ── scene builders ─────────────────────────────────────────────────────────
export const builders = {};

/* Rolling down an incline. World: incline surface from (0, h) down to (w, 0); z across the ramp; ball at z = 0. */
builders.rolling_incline = function (stage, impl, p) {
  const { scene } = stage;
  const th = p.angle * Math.PI / 180, L = p.length, R = p.radius, h = L * Math.sin(th), w = L * Math.cos(th);
  const nrm = new THREE.Vector3(Math.sin(th), Math.cos(th), 0), along = new THREE.Vector3(Math.cos(th), -Math.sin(th), 0);
  const width = Math.max(4 * R, 1.2);
  slab(scene, [[0, 0], [w, 0], [0, h]], width);
  // the θ arc at the foot of the ramp, on its front face
  angleArc(scene, new THREE.Vector3(w, 0, width / 2 + 0.003), Math.min(0.5, L * 0.12), Math.PI - th, Math.PI, 0xa3a7b3);
  const B = ball(scene, R);
  const cm = marker(scene, R * 0.05);
  const arrows = { mg: new Arrow(scene, PALETTE.mg, R * 0.022), N: new Arrow(scene, PALETTE.N, R * 0.02), f: new Arrow(scene, PALETTE.f, R * 0.02), v: new Arrow(scene, PALETTE.v, R * 0.018) };
  const gauge = 1.35 * R;     // the largest force draws this long
  const state = { centre: new THREE.Vector3(), contact: new THREE.Vector3(), tips: {} };
  function update(frame, ov) {
    const [cx, cy, sx, sy] = impl.centre(p, frame);
    state.centre.set(cx, cy, 0); state.contact.set(sx, sy, 0);
    B.position.copy(state.centre); B.rotation.set(0, 0, -frame.q[1]);
    cm.position.copy(state.centre);
    const forces = impl.fbd(p, frame); const maxF = Math.max(1e-9, ...forces.map(f => Math.hypot(f.vec[0], f.vec[1])));
    const show = ov.forces !== false;
    for (const f of forces) {
      const a = arrows[f.key === 'friction' ? 'f' : f.key === 'mg' ? 'mg' : 'N']; if (!a) continue;
      const m = Math.hypot(f.vec[0], f.vec[1]); a.update(new THREE.Vector3(f.at[0], f.at[1], 0), new THREE.Vector3(f.vec[0], f.vec[1], 0), show ? gauge * m / maxF : 0);
      state.tips[f.key === 'friction' ? 'friction' : f.key === 'mg' ? 'mg' : 'N'] = a.tip;
    }
    const v = frame.qd[0]; arrows.v.update(state.centre.clone().add(new THREE.Vector3(0, R * 1.15, 0)), along, ov.velocity && v > 0.01 ? Math.min(2.2 * R, 0.25 * R * v + 0.15 * R) : 0);
    return state;
  }
  function focus() { return state.centre; }
  function check(frame) {
    // contact point exactly on the slope plane, ball centre exactly R off it, ball inside the ramp width
    const d = state.contact.clone().dot(nrm) - new THREE.Vector3(0, h, 0).dot(nrm);
    const dc = state.centre.clone().sub(state.contact).dot(nrm) - R;
    return { contact_on_plane_m: Math.abs(d), centre_height_error_m: Math.abs(dc), inside_width: Math.abs(state.centre.z) + R <= width / 2 ? 0 : 1 };
  }
  const bounds = { center: new THREE.Vector3(w / 2, h / 2, 0), size: L };
  const cams = {
    hero: () => { const tg = state.centre.clone().add(new THREE.Vector3(0.06 * L, -0.11 * L, 0)); return [state.centre.clone().add(new THREE.Vector3(0.55, 0.3, 0.98).multiplyScalar(L)), tg]; },
    follow: () => [state.centre.clone().add(new THREE.Vector3(2.4 * R + 0.7, 1.4 * R + 0.5, 4.6 * R + 1.6)), state.centre.clone().add(new THREE.Vector3(0.3 * R, -0.35 * R, 0))],
    side: () => [new THREE.Vector3(w * 0.5, h * 0.5, L * 1.25), new THREE.Vector3(w * 0.5, h * 0.42, 0)],
  };
  return { update, focus, check, bounds, cams, labels: [['mg', PALETTE.mg, 25], ['N', PALETTE.N, -60], ['friction', PALETTE.f, 175]] };
};

/* Ball rolling off a fixed sphere: a big sphere on the floor, the ball on top rolling down, then flying. */
builders.ball_leaves_sphere = function (stage, impl, p) {
  const { scene } = stage;
  const Rs = p.R, r = p.r;
  const big = new THREE.Mesh(new THREE.SphereGeometry(Rs, 128, 96), matte(PALETTE.slab, { roughness: 0.85, envMapIntensity: 0.14 })); big.position.set(0, Rs, 0); big.castShadow = true; big.receiveShadow = true; scene.add(big);
  const B = ball(scene, r); const cm = marker(scene, r * 0.06);
  const arrows = { mg: new Arrow(scene, PALETTE.mg, r * 0.03), N: new Arrow(scene, PALETTE.N, r * 0.028), f: new Arrow(scene, PALETTE.f, r * 0.028), v: new Arrow(scene, PALETTE.v, r * 0.025) };
  const gauge = 1.5 * r; const state = { centre: new THREE.Vector3(), contact: new THREE.Vector3(), tips: {} };
  function update(frame, ov) {
    const [cx, cy] = impl.centre(p, frame); state.centre.set(cx, cy, 0);
    const th = frame.flags.mode === 'fly' ? frame.flags.theta_leave : frame.q[0];
    state.contact.set(Rs * Math.sin(th), Rs + Rs * Math.cos(th), 0);
    const spin = frame.flags.mode === 'fly' ? frame.flags.spin * frame.t : frame.q[1];
    B.position.copy(state.centre); B.rotation.set(0, 0, -spin); cm.position.copy(state.centre);
    const forces = impl.fbd(p, frame); const maxF = Math.max(1e-9, ...forces.map(f => Math.hypot(f.vec[0], f.vec[1])));
    for (const k of ['mg', 'N', 'f']) arrows[k].update(state.centre, new THREE.Vector3(0, 1, 0), 0);
    state.tips = {};
    for (const f of forces) { const a = arrows[f.key === 'friction' ? 'f' : f.key === 'mg' ? 'mg' : 'N']; if (!a) continue; const m = Math.hypot(f.vec[0], f.vec[1]); a.update(new THREE.Vector3(f.at[0], f.at[1], 0), new THREE.Vector3(f.vec[0], f.vec[1], 0), ov.forces !== false ? gauge * m / maxF : 0); state.tips[f.key === 'friction' ? 'friction' : f.key === 'mg' ? 'mg' : 'N'] = a.tip; }
    const vv = impl.vectors(p, frame).find(x => x.key === 'v'); if (vv) { const m = Math.hypot(vv.vec[0], vv.vec[1]); arrows.v.update(state.centre.clone().add(new THREE.Vector3(0, r * 1.2, 0)), new THREE.Vector3(vv.vec[0], vv.vec[1], 0), ov.velocity && m > 0.02 ? Math.min(3 * r, r * (0.5 + 0.6 * m)) : 0); }
    return state;
  }
  function focus() { return state.centre; }
  function check(frame) { if (frame.flags.mode === 'fly') return { in_flight: 0 }; const d = state.centre.distanceTo(new THREE.Vector3(0, Rs, 0)) - (Rs + r); return { centre_distance_error_m: Math.abs(d) }; }
  const bounds = { center: new THREE.Vector3(0, Rs, 0), size: 2.4 * Rs };
  const cams = {
    hero: () => [new THREE.Vector3(2.6 * Rs, 2.3 * Rs, 5.0 * Rs), new THREE.Vector3(0.3 * Rs, 1.05 * Rs, 0)],
    follow: () => [state.centre.clone().add(new THREE.Vector3(6 * r + 0.4, 4 * r + 0.3, 10 * r + 0.8)), state.centre.clone()],
    side: () => [new THREE.Vector3(0.4 * Rs, 1.2 * Rs, 4.2 * Rs), new THREE.Vector3(0.4 * Rs, 1.1 * Rs, 0)],
  };
  return { update, focus, check, bounds, cams, labels: [['mg', PALETTE.mg, 90], ['N', PALETTE.N, -80], ['friction', PALETTE.f, 200]] };
};
