/* Kinema Lab — problem in, live 3D scene out. Time is a slider you own.
   The model writes a SCENE (bodies/joints/blows + steps + checks); Kinema2D runs it; buildGeneric draws it. */
import * as THREE from 'three';
import { makeStage, Callouts } from '/js/world3d.js';
import { buildGeneric } from '/js/world3d_generic.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const E = window.Kinema2D, PR = window.KinemaPresets, PD = window.KinemaPresetDefaults, PT = window.KinemaPresetTitles;
const esc = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (v, d) => !isFinite(v) ? '—' : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(d ?? (Math.abs(v) >= 10 ? 2 : 3));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
let TOASTT = null; function toast(m, ms) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(TOASTT); TOASTT = setTimeout(() => t.classList.remove('on'), ms || 2600); }
async function api(url, opts, ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 20000); try { const r = await fetch(url, { ...(opts || {}), signal: c.signal }); const ct = r.headers.get('content-type') || ''; const body = ct.includes('json') ? await r.json() : await r.text(); if (!r.ok) throw new Error((body && body.error) || ('HTTP ' + r.status)); return body; } finally { clearTimeout(t); } }
const KATEX = { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }], throwOnError: false };

// ── state ───────────────────────────────────────────────────────────────────
let SETTINGS = null, SCENE = null, SIM = null, T = 0, PLAYING = false, SPEED = 1, STEP = 0, LAST = 0, HL = [], PHOTO = null, CURRENT_ID = null;
let OV = { forces: true, velocity: true, labels: true, allForces: false };
let VIEW = 'hero';
let stage = null, world = null, call = null, labelPool = [], viewSet = false;

// ── boot ────────────────────────────────────────────────────────────────────
// Every button is wired BEFORE any network call: a slow or failed /api call must never leave a dead page
// (the owner's report 2026-09-04: "uploaded the pic, then just couldn't do anything").
(async function boot() {
  const ex = $('#example'); for (const [id, t] of Object.entries(PT)) { const o = document.createElement('option'); o.value = id; o.textContent = t[0]; ex.appendChild(o); }
  ex.addEventListener('change', () => { if (ex.value) loadExample(ex.value); ex.value = ''; });
  $('#solve').addEventListener('click', solve); $('#photobtn').addEventListener('click', () => $('#photo').click()); $('#photo').addEventListener('change', e => photoPicked(e.target.files));
  $('#savebtn').addEventListener('click', saveProblem);
  $('#restart').addEventListener('click', () => { T = 0; PLAYING = false; playIcon(); setFrame(T); });
  $('#back').addEventListener('click', () => stepFrame(-1)); $('#fwd').addEventListener('click', () => stepFrame(1)); $('#playbtn').addEventListener('click', togglePlay);
  $('#scrub').addEventListener('input', e => { if (!SIM) return; PLAYING = false; playIcon(); setFrame(SIM.duration * e.target.value / 1000); });
  $('#speed').addEventListener('change', e => { SPEED = parseFloat(e.target.value); });
  $('#prevstep').addEventListener('click', () => gotoStep(STEP - 1)); $('#nextstep').addEventListener('click', () => gotoStep(STEP + 1));
  $('#applyjson').addEventListener('click', applyJson);
  document.addEventListener('keydown', ev => { if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) return; if (!SIM) return;
    if (ev.key === ' ') { ev.preventDefault(); togglePlay(); } if (ev.key === 'ArrowLeft') stepFrame(-1); if (ev.key === 'ArrowRight') stepFrame(1); if (ev.key === '[') setSpeed(-1); if (ev.key === ']') setSpeed(1);
    const v = { 1: 'hero', 2: 'follow', 3: 'side', 4: 'top' }[ev.key]; if (v) setView(v); });
  window.__lab = { get T() { return T; }, setT: t => setFrame(clamp(t, 0, SIM ? SIM.duration : 0)), loadExample, setView, gotoStep, solve, state: () => ({ T, VIEW, OV, STEP, scene: SCENE && SCENE.title, duration: SIM && SIM.duration, checks: SCENE && SCENE._checks, error: $('#errcard').hidden ? null : $('#errcard').textContent.slice(0, 300) }) };
  window.__ready = true;
  try { const h = await api('/api/health'); $('#health').textContent = 'v' + h.version; $('#health').classList.add('ok'); } catch (e) { $('#health').textContent = 'offline'; $('#health').classList.add('bad'); }
  loadBank();
  const qs = new URLSearchParams(location.search); if (qs.get('example')) loadExample(qs.get('example')); if (qs.get('problem')) openProblem(qs.get('problem'));
})();
function showError(title, detail, raw) {
  const el = $('#errcard'); el.hidden = false; $('#rnote').hidden = true;
  el.innerHTML = `<b>✗ ${esc(title)}</b>${detail ? `<div class="expr" style="color:var(--ink);white-space:pre-wrap">${esc(detail)}</div>` : ''}${raw ? `<details style="margin-top:6px"><summary class="note" style="cursor:pointer">what the model returned</summary><pre style="white-space:pre-wrap;font:11px/1.4 var(--mono);color:var(--dim);max-height:260px;overflow:auto;margin-top:6px">${esc(raw)}</pre></details>` : ''}`;
}
function clearError() { $('#errcard').hidden = true; }

// ── solving ─────────────────────────────────────────────────────────────────
function photoPicked(files) { if (!files || !files[0]) return; PHOTO = files[0]; const th = $('#thumb'); th.src = URL.createObjectURL(PHOTO); th.hidden = false; }
async function solve() {
  const text = $('#ptext').value.trim(); if (!text && !PHOTO) { toast('Paste the problem or add a photo first'); showError('Nothing to solve yet', 'Paste the problem text, or add a photo of it, then press Solve.'); return; }
  const btn = $('#solve'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Fable is writing the scene…'; clearError();
  const fd = new FormData(); fd.append('text', text); fd.append('mode', 'scene'); if (PHOTO) fd.append('image', PHOTO, PHOTO.name);
  fd.append('provider', 'claude'); fd.append('claude_model', 'fable'); fd.append('effort', 'high');      // the only model (owner ruling 2026-09-04)
  const t0 = Date.now(); let tick = setInterval(() => { btn.innerHTML = `<span class="spin"></span> Fable is writing the scene… ${((Date.now() - t0) / 1000).toFixed(0)} s`; }, 1000);
  try {
    const r = await api('/api/solve', { method: 'POST', body: fd }, 900000);
    CURRENT_ID = null; const ok = loadScene(r.scene, { warnings: r.warnings, text, image: r.image, meta: r.meta, raw: r.raw });
    if (ok) { toast(`Fable 5.1 · ${((Date.now() - t0) / 1000).toFixed(0)} s`); $('#savebtn').disabled = false; }
  } catch (e) { const msg = (e && e.name === 'AbortError') ? 'No answer within 15 minutes.' : (e.message || String(e)); toast('Solve failed: ' + msg, 6000); showError('The solve failed', msg + '\n\nThe attempt is logged in data/solve.log on the server.'); }
  finally { clearInterval(tick); btn.disabled = false; btn.textContent = 'Solve · build the scene'; }
}
function loadExample(id) {
  if (!PR[id]) return; const spec = PR[id](PD[id]); const t = PT[id];
  const scene = { ...spec, title: t[0], restatement: t[1], givens: [], unknowns: [],
    steps: [{ title: 'Setup', body: 'The scene as the engine sees it: every force on the focus body is measured from the contact and joint solver, not drawn from a formula. Press **play**, or scrub.', at: 0, show: ['forces', 'labels'], camera: null, highlight: [] },
            { title: 'Watch it move', body: 'Slow it down with **[** and speed up with **]**. Cameras: **1** hero · **2** follow · **3** side · **4** top. Drag to orbit, wheel to zoom.', at: null, show: ['forces', 'velocity', 'labels'], camera: null, highlight: [] }],
    checks: [], answer: { label: '', value: null, units: '', expression: '', note: 'worked example — no model answer to check' }, notes: '' };
  CURRENT_ID = null; loadScene(scene, { warnings: [], text: '', image: null, meta: { provider: 'example' } }); $('#savebtn').disabled = false;
}

async function applyJson() {
  if (!SCENE) return; let edited;
  try { edited = JSON.parse($('#scenejson').value); } catch (e) { toast('That is not valid JSON: ' + e.message, 5000); return; }
  const keep = { steps: SCENE.steps, givens: SCENE.givens, unknowns: SCENE.unknowns, notes: SCENE.notes, answer: SCENE.answer, checks: SCENE.checks };
  try {
    const r = await api('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: { ...edited, ...keep } }) });
    const ctx = SCENE._ctx || {}; loadScene(r.scene, { ...ctx, warnings: r.warnings });
    toast(r.warnings.length ? 'Re-ran with repairs — see warnings' : 'Re-ran');
  } catch (e) { toast('Could not re-run: ' + (e.message || e), 5000); }
}

// ── the 3D stage ────────────────────────────────────────────────────────────
function newStage() {
  if (stage) { stage.renderer.dispose(); stage.renderer.domElement.remove(); stage.controls.dispose(); }
  $('#callouts').innerHTML = ''; $('#leaders').innerHTML = ''; labelPool = [];
  stage = makeStage($('#gl'), { fov: 30 });
  call = new Callouts($('#callouts'), $('#leaders'), stage.camera);
  new ResizeObserver(() => stage.resize()).observe($('#stage'));
}
function loadScene(scene, ctx) {
  ctx = ctx || {}; clearError();
  if (!scene || !(scene.bodies || []).length) { showError('The model returned no usable scene', (ctx.warnings || []).join('\n') || 'No bodies survived validation.', ctx.raw); return false; }
  SCENE = scene; SCENE._ctx = ctx;
  const spec = { ...scene }; delete spec._ctx;
  try { SIM = E.simulate(spec); } catch (e) { showError('The engine could not run this scene', (e.message || String(e)) + '\n\n' + (ctx.warnings || []).join('\n'), ctx.raw || JSON.stringify(spec, null, 1)); window.__errs.push('simulate: ' + (e.message || e)); return false; }
  newStage();
  world = buildGeneric(stage, spec, SIM);
  stage.frameLights(world.bounds.center, world.bounds.size, !!spec.topdown); if (!spec.topdown) stage.setFloorY(world.bounds.floorY);
  VIEW = scene.camera || world.defaultView; viewSet = false;
  $('#empty').hidden = true; $('#stitle').hidden = false; $('#title').textContent = scene.title; $('#sub').textContent = scene.restatement || '';
  $('#controls').hidden = false; $('#views').hidden = false; $('#overlays').hidden = false; $('#rnote').hidden = true; $('#stepsbox').hidden = false; $('#qs').hidden = false; $('#bars').hidden = false;
  const w = $('#warnings'); w.hidden = !(ctx.warnings || []).length; w.innerHTML = (ctx.warnings || []).map(x => '⚠ ' + esc(x)).join('<br>');
  buildViewButtons(); buildOverlayButtons();
  T = 0; PLAYING = false; playIcon();
  SCENE._checks = runChecks();
  const jb = $('#jsonbox'); jb.hidden = false; const shown = { ...scene }; delete shown._ctx; delete shown._checks; delete shown.steps; delete shown.givens; delete shown.unknowns; delete shown.notes; delete shown.answer; delete shown.checks; $('#scenejson').value = JSON.stringify(shown, null, 1);
  renderSteps(); renderCheck(); gotoStep(0, true);
  if (!LOOPING) { LOOPING = true; requestAnimationFrame(loop); }
  return true;
}
function buildViewButtons() { const box = $('#views'); box.innerHTML = ''; for (const v of ['hero', 'follow', 'side', 'top']) { const b = document.createElement('button'); b.className = 'ov' + (VIEW === v ? ' on' : ''); b.textContent = v; b.dataset.v = v; b.onclick = () => setView(v); box.appendChild(b); } }
function buildOverlayButtons() { const box = $('#overlays'); box.innerHTML = ''; for (const [k, lab] of [['forces', 'Forces'], ['velocity', 'Velocity'], ['labels', 'Labels'], ['allForces', 'All bodies']]) { const b = document.createElement('button'); b.className = 'ov' + (OV[k] ? ' on' : ''); b.textContent = lab; b.dataset.k = k; b.onclick = () => { OV[k] = !OV[k]; b.classList.toggle('on', OV[k]); setFrame(T); }; box.appendChild(b); } }
function syncOverlayButtons() { $$('#overlays .ov').forEach(b => b.classList.toggle('on', !!OV[b.dataset.k])); }
function setView(v) { VIEW = v; viewSet = false; $$('#views .ov').forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
function placeCamera() {
  if (!world) return; const [eye, target] = world.cams[VIEW]();
  if (!viewSet) { stage.camera.position.copy(eye); stage.controls.target.copy(target); viewSet = true; }
  else if (VIEW === 'follow') { stage.camera.position.lerp(eye, 0.06); stage.controls.target.lerp(target, 0.1); }
}
function setFrame(t) {
  if (!SIM) return; T = clamp(t, 0, SIM.duration); const fr = E.frameAt(SIM, T); const st = world.update(fr, OV);
  while (labelPool.length < st.labels.length) labelPool.push(call.add('', '#fff', 0));
  labelPool.forEach((it, i) => { const L = st.labels[i]; if (!L || !OV.labels || !OV.forces) { it.on = false; return; } it.on = true; it.anchor.copy(L.tip); it.prefer = L.pref * Math.PI / 180;
    const col = '#' + L.color.toString(16).padStart(6, '0'); const html = `<i style="background:${col}"></i>${texLabel(L.label)} · ${L.value.toFixed(2)} N`;
    it.el.classList.toggle('hl', HL.includes(L.label) || HL.includes(L.label.replace(/[₁₂]/g, m => ({ '₁': '1', '₂': '2' })[m])));
    if (it.el.dataset.v !== html) { it.el.innerHTML = html; it.el.dataset.v = html; it.ln.setAttribute('stroke', col); it.dot.setAttribute('fill', col); if (window.renderMathInElement) renderMathInElement(it.el, { delimiters: [{ left: '$', right: '$', display: false }], throwOnError: false }); } });
  const fb = fr.bodies[SCENE.focus]; const v = fb ? Math.hypot(fb.vx, fb.vy) : 0;
  if (fb) { const ke = 0.5 * fb.m * v * v + 0.5 * fb.I * fb.w * fb.w; $('#readout').innerHTML = `<div>speed<b>${fmt(v)} m/s</b></div><div>ω<b>${fmt(fb.w)} rad/s</b></div><div>KE<b>${fmt(ke)} J</b></div>`; }
  $('#scrub').value = SIM.duration ? Math.round(1000 * T / SIM.duration) : 0; $('#tlab').textContent = `${T.toFixed(2)} s / ${SIM.duration.toFixed(2)} s${SPEED !== 1 ? ' · ' + SPEED + '×' : ''}`;
  updatePanels(fr);
}
function texLabel(s) { return s.replace(/^mg$/, '$mg$').replace(/^N$/, '$N$').replace(/^f$/, 'f').replace(/^T$/, '$T$').replace(/^F_pivot$/, '$F_{\\text{pivot}}$'); }
let LOOPING = false;
function loop(now) {
  if (PLAYING && SIM) { T = Math.min(SIM.duration, T + Math.min(0.1, (now - LAST) / 1000) * SPEED); setFrame(T); if (T >= SIM.duration) { PLAYING = false; playIcon(); } }
  LAST = now;
  if (stage && world) { placeCamera(); stage.controls.update(); stage.renderer.render(stage.scene, stage.camera); call.layout(world.focus(), world.focusSize, stage.renderer.domElement.clientWidth, stage.renderer.domElement.clientHeight); }
  requestAnimationFrame(loop);
}
function togglePlay() { if (!SIM) return; if (!PLAYING && T >= SIM.duration - 1e-9) T = 0; PLAYING = !PLAYING; LAST = performance.now(); playIcon(); }
function playIcon() { $('#playbtn').innerHTML = PLAYING ? '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; }
function stepFrame(dir) { if (!SIM) return; PLAYING = false; playIcon(); setFrame(T + dir / 60); }
function setSpeed(dir) { const opts = [0.1, 0.25, 0.5, 1, 2]; let i = opts.indexOf(SPEED); i = clamp(i + dir, 0, opts.length - 1); SPEED = opts[i]; $('#speed').value = String(SPEED); toast(SPEED + '×', 900); }

// ── panels ──────────────────────────────────────────────────────────────────
function updatePanels(fr) {
  const fb = fr.bodies[SCENE.focus]; if (!fb) return;
  const forces = fr.forces.filter(f => f.body === SCENE.focus && Math.hypot(f.vec[0], f.vec[1]) > 1e-3);
  const rows = forces.map(f => { const m = Math.hypot(f.vec[0], f.vec[1]); const col = { gravity: '#ff5d5d', normal: '#45d483', friction: '#ffb547', joint: '#4fd8c4', applied: '#ff7ab6' }[f.kind] || '#fff'; return `<div class="q"><span><i style="background:${col}"></i>${esc(f.label || f.kind)}${f.other ? ' <span style="color:var(--faint)">from ' + esc(f.other) + '</span>' : ''}</span><b>${fmt(m)} N</b></div>`; });
  const v = Math.hypot(fb.vx, fb.vy), ke = 0.5 * fb.m * v * v, kr = 0.5 * fb.I * fb.w * fb.w, pe = fb.m * (SCENE.gravity ?? 9.8) * (fb.cy - (world.bounds.floorY || 0));
  $('#qs').innerHTML = `<div class="sec">Forces on ${esc(SCENE.focus)} · now</div>` + (rows.join('') || '<div class="note">none</div>') +
    `<div class="sec" style="margin-top:10px">${esc(SCENE.focus)} · now</div><div class="q"><span>mass</span><b>${fmt(fb.m)} kg</b></div><div class="q"><span>I about its centre of mass</span><b>${fmt(fb.I, 4)} kg·m²</b></div><div class="q"><span>L = Iω</span><b>${fmt(fb.I * fb.w)} kg·m²/s</b></div><div class="q"><span>speed</span><b>${fmt(v)} m/s</b></div><div class="q"><span>ω</span><b>${fmt(fb.w)} rad/s</b></div><div class="q"><span>position</span><b>(${fmt(fb.cx, 2)}, ${fmt(fb.cy, 2)}) m</b></div><div class="q"><span>angle</span><b>${fmt(fb.a * 180 / Math.PI, 1)}°</b></div>`;
  const tot = Math.max(1e-9, ke + kr + Math.max(0, pe)); const bar = (l, val, c) => `<div class="bar"><span>${l}</span><i style="width:${clamp(100 * Math.max(0, val) / tot, 0, 100).toFixed(1)}%;background:${c}"></i><b>${fmt(val, 2)} J</b></div>`;
  $('#bars').innerHTML = '<div class="sec">Energy</div>' + bar('translational', ke, '#5b7cff') + bar('rotational', kr, '#c4a3ff') + (SCENE.gravity ? bar('potential', pe, '#ff5d5d') : '');
}
function mdlite(src) {
  let t = esc(src);
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/((?:^[-*]\s.+\n?)+)/gm, m => '<ul>' + m.trim().split(/\n/).map(l => '<li>' + l.replace(/^[-*]\s+/, '') + '</li>').join('') + '</ul>');
  t = t.replace(/((?:^\d+[.)]\s.+\n?)+)/gm, m => '<ol>' + m.trim().split(/\n/).map(l => '<li>' + l.replace(/^\d+[.)]\s+/, '') + '</li>').join('') + '</ol>');
  return t.split(/\n{2,}/).map(p => /^<(ul|ol)/.test(p) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
}
function renderSteps() {
  const box = $('#steps'); box.innerHTML = SCENE.steps.map((st, i) => `<div class="step" id="st${i}"><button data-i="${i}"><span class="n">${i + 1}</span><span class="t">${esc(st.title)}</span>${st.at != null ? `<span class="at">${st.at.toFixed(1)} s</span>` : ''}</button><div class="body">${mdlite(st.body)}</div></div>`).join('');
  $$('#steps .step > button').forEach(b => b.addEventListener('click', () => gotoStep(+b.dataset.i)));
  if (window.renderMathInElement) try { renderMathInElement(box, KATEX); } catch (e) { }
}
function gotoStep(i, silent) {
  if (!SCENE) return; STEP = clamp(i, 0, SCENE.steps.length - 1); const st = SCENE.steps[STEP];
  $$('.step').forEach((el, j) => el.classList.toggle('cur', j === STEP));
  if (st.show && st.show.length) { OV.forces = st.show.includes('forces') || st.show.includes('all_forces'); OV.velocity = st.show.includes('velocity'); OV.labels = st.show.includes('labels') || OV.forces; OV.allForces = st.show.includes('all_forces'); syncOverlayButtons(); }
  if (st.camera) setView(st.camera);
  HL = st.highlight || [];
  if (SIM && st.at != null) { PLAYING = false; playIcon(); T = clamp(st.at, 0, SIM.duration); }
  setFrame(T);
  if (!silent) $('#st' + STEP).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── checks: the model's numbers against the engine ──────────────────────────
function measure(c) {
  const fr = c.at == null ? SIM.frames[SIM.frames.length - 1] : E.frameAt(SIM, c.at);
  if (c.quantity === 'joint_force') { const j = fr.joints[c.joint]; return j ? Math.hypot(j.force[0], j.force[1]) : NaN; }
  const b = fr.bodies[c.body]; if (!b) return NaN;
  switch (c.quantity) {
    case 'speed': return Math.hypot(b.vx, b.vy);
    case 'omega': return b.w;
    case 'vx': return b.vx; case 'vy': return b.vy; case 'x': return b.cx; case 'y': return b.cy;
    case 'angle_deg': return b.a * 180 / Math.PI;
    case 'mass': return b.m; case 'inertia': return b.I;
    case 'ke': return 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + 0.5 * b.I * b.w * b.w;
    case 'ax': case 'ay': { const i = SIM.frames.indexOf(fr); const k = Math.max(1, Math.round(0.0125 / SIM.dt)); const a = SIM.frames[clamp(i - k, 0, SIM.frames.length - 1)].bodies[c.body], z = SIM.frames[clamp(i + k, 0, SIM.frames.length - 1)].bodies[c.body]; const dtt = (clamp(i + k, 0, SIM.frames.length - 1) - clamp(i - k, 0, SIM.frames.length - 1)) * SIM.dt; return dtt > 0 ? ((c.quantity === 'ax' ? z.vx - a.vx : z.vy - a.vy) / dtt) : NaN; }
    case 'normal': case 'friction': { const f = fr.forces.filter(x => x.body === c.body && x.kind === c.quantity); return f.reduce((s, x) => s + Math.hypot(x.vec[0], x.vec[1]), 0); }
  }
  return NaN;
}
function runChecks() {
  return (SCENE.checks || []).map(c => { const got = measure(c); const tol = (c.tol_pct || 3) / 100; const ref = Math.max(Math.abs(c.expect), 1e-6);
    const signed = Math.abs(got - c.expect) <= tol * ref, unsigned = Math.abs(Math.abs(got) - Math.abs(c.expect)) <= tol * ref;
    return { ...c, got, status: !isFinite(got) ? 'na' : signed ? 'ok' : unsigned ? 'sign' : 'bad' }; });
}
function renderCheck() {
  const el = $('#check'); el.hidden = false; const a = SCENE.answer || {}; const checks = SCENE._checks || [];
  const nOk = checks.filter(c => c.status === 'ok').length, nBad = checks.filter(c => c.status === 'bad').length;
  el.className = 'check ' + (checks.length ? (nBad ? 'bad' : 'ok') : 'na');
  const tex = s => s.includes('$') ? esc(s) : '$' + esc(s) + '$';
  let html = `<b>${checks.length ? (nBad ? `✗ ${nBad} of ${checks.length} model numbers disagree with the engine` : `✓ ${nOk} of ${checks.length} model numbers match the engine`) : 'no engine checks'}</b>`;
  if (a.value != null || a.expression) html += `<div class="expr">answer: ${a.label ? esc(a.label) + ' = ' : ''}${a.value != null ? fmt(a.value) + ' ' + esc(a.units || '') : ''}${a.expression ? ' · ' + tex(a.expression) : ''}</div>`;
  if (a.note) html += `<div class="expr">${esc(a.note)}</div>`;
  html += checks.map(c => `<div class="crow ${c.status}"><span>${esc(c.label)}${c.at != null ? ' @ ' + c.at.toFixed(2) + ' s' : ''}</span><b>model ${fmt(c.expect)} · engine ${fmt(c.got)}${c.status === 'sign' ? ' (sign)' : ''}</b></div>`).join('');
  el.innerHTML = html;
  if (window.renderMathInElement) try { renderMathInElement(el, KATEX); } catch (e) { }
}

// ── bank ────────────────────────────────────────────────────────────────────
async function loadBank() {
  const rows = await api('/api/problems').catch(() => []); const box = $('#bank');
  box.innerHTML = rows.length ? rows.map(r => `<button class="brow" data-id="${esc(r.id)}"><div class="t"><b>${esc(r.title)}</b><span>${r.mode === 'template' ? 'classic template' : 'scene'} · ${new Date(r.updated_ts * 1000).toLocaleDateString()}</span></div><span class="x" data-del="${esc(r.id)}">×</span></button>`).join('') : '<div class="note" style="padding:12px 16px">Nothing saved yet.</div>';
  $$('#bank .brow').forEach(b => b.addEventListener('click', () => openProblem(b.dataset.id)));
  $$('#bank .x').forEach(x => x.addEventListener('click', ev => { ev.stopPropagation(); delProblem(x.dataset.del); }));
}
async function saveProblem() {
  if (!SCENE) return; const ctx = SCENE._ctx || {}; const scene = { ...SCENE }; delete scene._ctx; delete scene._checks;
  const r = await api('/api/problems', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: CURRENT_ID || undefined, title: SCENE.title, source: 'Morin ch. 8', text: ctx.text || $('#ptext').value, image: ctx.image || '', scene, meta: ctx.meta || {} }) }).catch(e => { toast('Save failed: ' + e.message); });
  if (r && r.ok) { CURRENT_ID = r.id; toast('Saved'); loadBank(); }
}
async function openProblem(id) {
  const d = await api('/api/problems/' + id).catch(e => { toast(e.message); }); if (!d) return;
  if (d.mode === 'template') { location.href = '/classic'; return; }
  CURRENT_ID = id; $('#ptext').value = d.text || ''; if (d.image) { $('#thumb').src = d.image; $('#thumb').hidden = false; }
  loadScene(d.scene, { warnings: d.warnings, text: d.text, image: d.image, meta: d.meta }); $('#savebtn').disabled = false;
}
async function delProblem(id) { if (!confirm('Delete this saved problem?')) return; await api('/api/problems/' + id, { method: 'DELETE' }); if (CURRENT_ID === id) CURRENT_ID = null; loadBank(); }
