import { controlIcon } from './icons.js';
import { SimulationLab } from './sim_lab.js';
import { zoomGlyph, nextView, labelView as cycleLabel } from './viewer_controls.js';
import './choice_menu.js';
import { ModelMenu } from './model_menu.js';
import { AccountPanel } from './account_panel.js';
import { SettingsPage } from './settings_page.js';
import { LanguagePanel } from './language_panel.js';
/* Kinema 1.17 — one shell: the tutor sidebar (New chat, Daily problem, Study path, Library, chats, Settings) hosts every
   page. Older problem, skill and practice views open full-screen with a Back bar. Model work runs as server jobs this page polls, so a solve survives a closed tab
   and Panel's embedding proxy. Visuals: planar mechanics (engine2d + scene3d), 3D rigid bodies (rigid3d), graphs,
   circuits and diagrams (study.js). */
import * as THREE from 'three';
import { makeStudio, hex, PALETTE } from './studio.js';
import { StageLabels } from './stage_labels.js';
import { buildScene } from './scene3d.js';
import { Lesson } from './lesson.js';
import { StudyView, checkResult, checkSummary } from './study.js';
import { buildRigid, OVERLAY_GROUPS, TEACH } from './rigid3d_view.js';
import { Coach } from './coach.js';
import { ProblemArtifact } from './problem_artifact.js';
import { esc, math, fmt } from './md.js';
import { Atlas, installTips } from './atlas.js';
import { SkillPage } from './skill.js';
import { Quick } from './quick.js';
import { SessionView } from './session.js';
import { Teacher, READ } from './teacher.js';
import { Daily } from './daily.js';
import { LibraryFolders } from './library_folders.js';
import { WorkLibrary } from './work_library.js';
import { createForceIntent } from './visual_force_intent.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const E = window.Kinema2D, PR = window.KinemaPresets, PD = window.KinemaPresetDefaults, PT = window.KinemaPresetTitles;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Under Panel the app lives at /api/apps/kinema/view/; literal api('/…') calls are rewritten by Panel's proxy,
// computed paths go through url().
const BASE = (location.pathname.match(/^(.*\/api\/apps\/kinema\/view)(?:\/|$)/) || [])[1] || '';
// Panel's proxy already prefixes "/api/…" strings inside JSON replies, so a server-given path must not be prefixed twice.
const url = p => (BASE && String(p).startsWith(BASE + '/') ? p : BASE + p);
let TOASTT = null;
function toast(m, ms) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(TOASTT); TOASTT = setTimeout(() => t.classList.remove('on'), ms || 2600); }
async function api(u, opts, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 30000);
  const outer = opts && opts.signal; if (outer) { if (outer.aborted) c.abort(); else outer.addEventListener('abort', () => c.abort(), { once: true }); }
  try {
    const r = await fetch(u, { ...(opts || {}), signal: c.signal });
    const ct = r.headers.get('content-type') || '';
    const body = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) { const error = new Error((body && body.error) || (typeof body?.detail === 'string' && body.detail) || ('HTTP ' + r.status)); error.raw = body?.raw; error.status = r.status; error.body = body; throw error; }
    return body;
  } finally { clearTimeout(t); }
}
const texName = s => s.replace(/^mg$/, '$mg$').replace(/^N$/, '$N$').replace(/^T([₁₂₃₄]?)$/, (m, k) => '$T' + (k ? '_' + { '₁': 1, '₂': 2, '₃': 3, '₄': 4 }[k] : '') + '$').replace(/^F_pivot$/, '$F_{\\text{pivot}}$').replace(/^v$/, '$v$').replace(/^F$/, '$F$');

// ── state ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let studio = null, call = null, simLab = null;
let world = null, lesson = null, RIGID = null;                // mechanics world / its lesson runner / 3D rigid view
let SCENE = null, SIM = null, TUTOR = null, KIND = null;         // what is on the stage: 'mechanics' | 'rigid3d' | 'math'
let T = 0, PLAYING = false, STOP_AT = null, SPEED = 1, LAST = 0, LOOP = false, STEP = 0;
let OV = { forces: true, labels: true, tensions: true, velocity: false, trail: false, allForces: true, energy: false, axes: false, breakdown: false };
let OV3 = new Set(), HL = [], SEL = null, STEP_FOCUS = null, REFS3 = false, PROP = null;   // PROP: a static library prop being inspected
let CURRENT = null, VIEW = 'teacher', JOB = null, RETURN = 'library';   // RETURN: where Back goes from an older full-screen view
let STUDY = null, coach = null, atlas = null, skillp = null, quick = null, sessv = null, artifact = null, teacher = null, daily = null, libraryFolders = null, workLibrary = null;
let STAGE_QUIET = false, STAGE_OWNER = null, ORBITED = false, STAGE_STILL = false, FORCE_KEY_CHANGE = false;   // the tutor view loads the stage without switching to homework; ORBITED: the learner moved the camera since the last fit
let NATIVE_FORCE_INTENT = createForceIntent();

// ── boot ──────────────────────────────────────────────────────────────────────────────────────────────────────────
(async function boot() {
  const models = new ModelMenu({api, url, toast, onChange: refreshHeader});
  STUDY = new StudyView($('#study'), E.compileExpr, () => teacher?.paramsChanged());
  artifact = new ProblemArtifact({onPause: () => { PLAYING = false; playIcon(); }, onResize: () => { studio?.resize(); STUDY?.draw(T, true); }, onDetails: () => requestAnimationFrame(refitStage), onChange: (open, expanded) => teacher?.visualChanged(open, expanded)});
  coach = new Coach($('#coach'), { api, url, toast, onStep: applyStep, onNextPart: startNextPart, onClarify: clarify, openProblem, onCancel: cancelJob, zoom, openSkill: id => openSkill(id), configureVisual: (kind,title) => artifact.configure(kind,title), openVisual: () => artifact.open(true), visualOpen: () => artifact.opened, visualContext: () => artifact.context(), lockVisual: value => artifact.lock(value) });
  atlas = new Atlas({ api, url, openSkill });
  skillp = new SkillPage($('#skillbody'), { api, url, toast, back: () => goBack(), ask: (q, ctx) => quick.ask(q, ctx), onChange: refreshSummary,
    practise: id => { show('session'); sessv.startSkill(id); } });
  sessv = new SessionView($('#sessbody'), { api, url, toast, back: () => goBack(), openSkill, onChange: refreshSummary, goal,
    onLegacyCard: () => { show('teacher'); toast('Flashcards are in Recall. Your saved progress is kept.'); } });
  quick = new Quick({ api, url, openSkill, onChange: refreshSummary, goal,
    context: () => ({ problem_id: VIEW === 'problem' ? CURRENT : null, skill_id: VIEW === 'skill' ? skillp.k?.id : null }) });
  teacher = new Teacher($('#teacher'), { api, url, toast, stage: stageHost(), artifact, openProblem, openBookLibrary, show: () => show('teacher'), onPage, syncLab:syncLabThread, renderMap: (box, where) => atlas.loadMap(box, where) });
  libraryFolders = new LibraryFolders(teacher, { openFolder: openLibraryFolder, openSaved: id => { RETURN = 'library'; openProblem(id); } });
  workLibrary = new WorkLibrary($('#libwork'), {api, url,
    open: r => {
      if(r.kind === 'saved') {
        libraryFolders.clearSavedReturn(r.id); RETURN = 'library'; openProblem(r.id);
      } else {
        libraryFolders.clearThreadReturn(r.thread_id);
        teacher.leaveViews(); teacher.openThread(r.thread_id);
      }
    },
    image: (src,title) => window.KinemaImageViewer.open(src,title)
  });
  daily = new Daily($('#daily'), { api, url });
  // Simulation conversations use Teacher; the lab module only mounts a viewer.
  $('#sim-lab').hidden=true;
  simLab=new SimulationLab(document.createElement('div'),{api,url});
  for (const id of ['daily', 'library', 'settings', 'sim-lab']) { const n = $('#' + id); n.dataset.page = id; n.hidden = true; teacher.el.page.appendChild(n); }
  $('#libvisuals').appendChild(teacher.el.gallery);
  installTips();
  wire();
  const languages = new LanguagePanel({api, url, teacher});
  teacher.languages = languages;
  const accountPanel = new AccountPanel({teacher, api, url, models, openLanguage: () => languages.open(), translate: (...args) => languages.t(...args)});
  const settings = new SettingsPage({teacher, api, url, toast, languages, accountPanel, models, readSizes: READ});
  window.__app = { teacher, simLab, models, languages, accountPanel, settings, get T() { return T; }, setT, loadResult, openProblem, show, state: () => ({ view: VIEW, T, STEP, kind: KIND, owner: STAGE_OWNER, title: TUTOR?.title || SCENE?.title, duration: SIM?.duration, current: CURRENT, job: JOB, errs: window.__errs, checks: RIGID ? RIGID.checks : SCENE?._checks }) };
  window.__ready = true;
  try { studio = await makeStudio($('#gl'), { fov: 26, resizeFrame: () => ORBITED && KIND === 'mechanics' ? world?.resizeFrame() : null }); call = new StageLabels($('#callouts'), $('#stage'), studio.camera); window.__stageLabels = call; initCameraControls(); new ResizeObserver(stageResized).observe($('#stage')); studio.controls.addEventListener('start', () => { ORBITED = true; viewLabel(); }); }
  catch (e) { (window.__errs = window.__errs || []).push('3D unavailable: ' + (e.message || e)); }
  studioReady();
  requestAnimationFrame(loop);
  refreshHeader();
  const qs = new URLSearchParams(location.search), vw = qs.get('view');
  if (qs.get('problem')) { RETURN = 'library'; openProblem(qs.get('problem')); }
  else if (qs.get('example')) loadExample(qs.get('example'));
  else if (qs.get('skill')) openSkill(qs.get('skill'));
  else if (qs.get('session')) startSession();
  else if (['daily', 'library'].includes(vw)) show(vw);
  else if (vw === 'study') { show('atlas'); resumeRunningJob(); }
  else { show('teacher'); resumeRunningJob(); }
  await languages.init();
  await accountPanel.init();
  await settings.init();
  if (vw === 'settings') settings.open(qs.get('section') || null);
  window.__studioReady = true;
})();

function wire() {
  $('#lback').addEventListener('click', goBack);
  document.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length || !['teacher', 'daily', 'library', 'atlas'].includes(VIEW)) return;
    if (document.activeElement?.closest('#tv-input')) return;   // the composer takes its own paste
    if (VIEW === 'daily' && document.activeElement?.closest('#daily')) return;
    e.preventDefault(); show('teacher'); teacher.intake(files);
  });
  $('#libtabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) {if(b.dataset.collection)LIBCOLLECTION=b.dataset.collection;libTab(b.dataset.tab);} });
  $('#zoom').addEventListener('click', () => { $('#zoom').hidden = true; });
  // transport
  for(const [id,name,label] of [['back','left','Previous frame'],['fwd','right','Next frame']]){const b=$('#'+id);b.innerHTML=controlIcon(name);b.setAttribute('aria-label',label);}
  $('#playbtn').addEventListener('click', togglePlay); $('#back').addEventListener('click', () => stepFrame(-1)); $('#fwd').addEventListener('click', () => stepFrame(1));
  $('#spd').addEventListener('click', () => setSpeed(1)); $('#spd').addEventListener('contextmenu', e => { e.preventDefault(); setSpeed(-1); });
  $('#views').addEventListener('click', e => { e.stopPropagation(); cycleCamera(); });
  const bar = $('#bar'); let scrubbing = false;
  const scrubAt = e => { if (!SIM) return; const r = bar.getBoundingClientRect(); setT(SIM.duration * clamp((e.clientX - r.left) / r.width, 0, 1)); };
  bar.addEventListener('pointerdown', e => { scrubbing = true; PLAYING = false; playIcon(); bar.setPointerCapture(e.pointerId); scrubAt(e); });
  bar.addEventListener('pointermove', e => { if (scrubbing) scrubAt(e); }); bar.addEventListener('pointerup', () => scrubbing = false);
  bar.addEventListener('keydown', e => { if (!SIM) return; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); PLAYING = false; playIcon(); setT(e.key === 'Home' ? 0 : e.key === 'End' ? SIM.duration : T + (e.key === 'ArrowLeft' ? -1 : 1) * SIM.duration / 100); } });
  $('#gl').addEventListener('pointerdown', e => { window.__down = [e.clientX, e.clientY]; });
  $('#gl').addEventListener('pointerup', e => { const d = window.__down; if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 5) clickStage(e); });
  document.addEventListener('keydown', onKey);
}
function onKey(ev) {
  const tag = document.activeElement?.tagName;
  if (VIEW === 'session') { if (!['TEXTAREA', 'INPUT'].includes(tag) && sessv.key(ev)) ev.preventDefault(); return; }
  if (VIEW === 'skill') { if (!['TEXTAREA', 'INPUT'].includes(tag) && skillp.key(ev)) ev.preventDefault(); return; }
  if (ev.key === 'Escape') { $('#zoom').hidden = true; clearSelection(); }
  if (['TEXTAREA', 'INPUT', 'SELECT'].includes(tag)) return;
  if (VIEW === 'teacher' && teacher?.thread?.mode==='simulation') return;
  if (VIEW === 'teacher') { if (artifact?.opened && document.activeElement?.closest('#problem-artifact') && tag !== 'BUTTON') stageKeys(ev); return; }
  if (VIEW !== 'problem') return;
  if (!$('#pane').inert && !document.activeElement?.closest('#problem-artifact')) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); coach.key(1); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); coach.key(-1); return; }
  }
  if (!artifact?.opened || tag === 'BUTTON') return;
  stageKeys(ev);
}
function stageKeys(ev) {
  if (!SIM || !(SIM.duration > 0)) return;
  if (ev.key === ' ') { ev.preventDefault(); togglePlay(); }
  if (ev.key === 'ArrowLeft') stepFrame(-1); if (ev.key === 'ArrowRight') stepFrame(1);
  if (ev.key === '[') setSpeed(-1); if (ev.key === ']') setSpeed(1);
  const v = { 1: 'hero', 2: 'follow', 3: 'side', 4: 'top', 5: 'closeup' }[ev.key]; if (v) setCamera(v, true);
}

// ── views ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const SHELL = new Set(['teacher', 'daily', 'library', 'atlas']);
const BAR = { skill: 'Skill', session: 'Practice', problem: 'Problem' };
function show(view) {
  if (view === 'review' || view === 'home') view = 'teacher';   // retired pages cannot be reopened
  const prev = VIEW;
  VIEW = view;
  const inShell = SHELL.has(view), page = ['daily', 'library'].includes(view) ? view : null;
  if (!inShell) { teacher?.leave(); if (SHELL.has(prev)) RETURN = prev === 'teacher' ? 'teacher' : prev === 'atlas' ? 'atlas' : prev; }
  if (view !== 'daily') daily?.leave();
  if (!inShell && teacher?.thread?.mode==='simulation') artifact?.open(false,false);
  if (inShell) artifact?.attach($('#teacher'), $('#tv-main'), $('#tv-visual'));
  else if (view === 'problem' && artifact?.root.id === 'teacher') { artifact.open(false, false); artifact.attach($('#workspace'), $('#pane'), $('#workspace')); }
  artifact?.setActive(view === 'problem' || inShell);
  const tip = $('#tip'); if (tip) tip.style.display = 'none';
  for (const [id, v] of [['#teacher', inShell], ['#skill', view === 'skill'], ['#session', view === 'session'], ['#workspace', view === 'problem']]) $(id).hidden = !v;
  document.body.className = 'v-' + (inShell ? 'teacher' : view) + (page ? ' v-' + page : '') + (inShell && !page && view !== 'atlas' && KIND === 'math' || view === 'problem' && KIND === 'math' ? ' math-view' : '');
  $('#lbar').hidden = inShell; $('#ltitle').textContent = BAR[view] || '';
  if (!inShell || view === 'problem') { PLAYING = false; playIcon(); }
  if (inShell) {
    const go = async () => { const nav = teacher.navigationEpoch || 0; await teacher.enter(); if (VIEW !== view || (teacher.navigationEpoch || 0) !== nav) return; if (page) teacher.openPage(page); else if (view === 'atlas') teacher.openPage('path'); else teacher.leaveViews(); };
    go();
  }
  if (view === 'problem' && studio) requestAnimationFrame(() => studio.resize());
}
// Render the current validated assembly through the ordinary artifact lifecycle.
let labMountKey=null,labMountPromise=null;
async function syncLabThread(thread,reentered=false){
  const art=thread.artifact;if(!art?.lab_document)return;
  const key=thread.id+'@'+art.revision;
  if(labMountKey===key&&labMountPromise){
    const prior=await labMountPromise;
    if(prior.cancelled&&teacher?.active&&!teacher.page&&teacher.thread?.id===thread.id&&teacher.thread.artifact?.revision===art.revision)return syncLabThread(thread,reentered);
    return prior;
  }
  if(labMountKey===key&&artifact.sceneHandle?.labKey===key){if(reentered)artifact.open(true,false);return;}
  labMountKey=key;
  labMountPromise=artifact.showScene(art.starter?'Starting setup: pendulum':art.title,async host=>{
    host.appendChild(simLab.host);
    const generation=simLab.generation=(simLab.generation||0)+1;
    await simLab.mount(art);
    return {labKey:key,resize:()=>simLab.resize(),destroy:()=>{if(generation===simLab.generation)simLab.destroy();}};
  });
  try{const result=await labMountPromise;if(!result.ok&&!result.cancelled)toast(result.error);}
  finally{if(labMountKey===key)labMountPromise=null;}
}
function goBack() {
  const origin = VIEW === 'problem' && CURRENT && libraryFolders?.savedReturn(CURRENT);
  if (origin) { LIBTAB = 'problems'; LIBCOLLECTION = 'folders'; libraryFolders.restore = origin; show('library'); return; }
  show(RETURN === 'problem' || !RETURN ? 'library' : RETURN);
}
function openSkill(id) { show('skill'); skillp.open(id); }
function startSession() { show('session'); sessv.start(); }
/* called by the tutor shell when a page (daily, library, path) opens or closes */
function onPage(name, opening) {
  if (name === 'daily') { if (opening) daily.enter(); else daily.leave(); }
  else if (name === 'library' && opening) libTab(LIBTAB);
  else if (name === 'settings') { if (opening) window.__app?.settings?.enter(); else window.__app?.settings?.leave(); }
}

/* plain words from the owner: "practise chapter 9 before my next class" starts practice; anything else goes to Luna */
async function goal(text, options = {}) {
  if (window.KinemaAccount && !window.KinemaAccount.signedIn) { window.KinemaAccount.promptSignIn(); return 'blocked'; }
  let r;
  try { r = await api(url('/api/goal'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...options }) }, 200000); }
  catch (e) { toast('Could not start: ' + e.message, 8000); return 'blocked'; }
  if (r.kind === 'question') { if (options.fromChat) return false; quick.ask(text); return true; }
  if (r.kind === 'clarify') { if (options.fromChat) { toast(r.reply, 10000); return 'blocked'; } const reply = document.querySelector('.goal-reply'); if (reply) { reply.hidden = false; reply.textContent = r.reply; } else toast(r.reply,10000); return 'blocked'; }
  if (r.error) { toast(r.error, 10000); return 'blocked'; }
  clearTimeout(TOASTT); $('#toast').classList.remove('on');
  show('session'); sessv.begin(r); return true;
}
async function refreshHeader() {
  try { const h = await api('/api/health'); VERSION = h.version; $('#setver') && ($('#setver').textContent = 'Kinema v' + h.version); } catch { /* offline */ }
}
let VERSION = '';
async function refreshSummary() { /* the sidebar carries no counters; skill and practice views refresh themselves */ }
function label(r) {
  const vis = { rigid3d: '3D model', mechanics: 'simulation', circuit: 'circuit', plot: 'graph', diagram: 'diagram', none: 'solution' }[r.visual] || (r.mode === 'scene' ? 'simulation' : '');
  const when = new Date(r.updated_ts * 1000); const today = new Date();
  const d = when.toDateString() === today.toDateString() ? when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : when.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return [r.part ? 'part ' + r.part : '', vis, d, r.messages ? r.messages / 2 + ' questions' : ''].filter(Boolean).join(' · ');
}
let LIBTAB = 'problems', LIBCOLLECTION = 'catalog';
try { const saved=sessionStorage.getItem('kinema.library.collection'); if(['catalog','folders'].includes(saved)) LIBCOLLECTION=saved; } catch { }
function openBookLibrary() {
  LIBTAB = 'problems'; LIBCOLLECTION = 'catalog';
  if (teacher.page === 'library') libTab('problems'); else teacher.openPage('library');
}
function openLibraryFolder(id, scroll = 0) {
  LIBTAB = 'problems'; LIBCOLLECTION = 'folders'; libraryFolders.restore = {folder_id:id,scroll};
  if (teacher.page === 'library') libTab('problems'); else teacher.openPage('library');
}
function libCollection(value) {
  LIBCOLLECTION = ['folders'].includes(value) ? value : 'catalog';
  try { sessionStorage.setItem('kinema.library.collection',LIBCOLLECTION); } catch { }
  $$('#libcollections [data-collection]').forEach(b => b.setAttribute('aria-current', b.dataset.collection === LIBCOLLECTION ? 'page' : 'false'));
  $('#libcatalog').hidden = LIBCOLLECTION !== 'catalog'; $('#libwork').hidden = true; $('#libfolders').hidden = LIBCOLLECTION !== 'folders';
  if (LIBCOLLECTION === 'catalog') teacher.book.mountLibrary($('#libcatalog')); else if (LIBCOLLECTION === 'folders') libraryFolders.enter(); else renderLibrary();
}
function libTab(t) {
  if (t === 'visuals') t = 'simulations';   // the older name of the Simulations tab
  if (!['problems', 'simulations', 'graphs', 'materials'].includes(t)) t = 'problems';
  if(t!==LIBTAB||t==='problems'){
    teacher.libraryPreviewEpoch=(teacher.libraryPreviewEpoch||0)+1;
    teacher.gallery?.cancel();teacher.grShown=null;
    teacher.quietly(()=>teacher.artifact.open(false,false));
  }
  LIBTAB = t;
  $('#library-title').textContent=({problems:LIBCOLLECTION==='folders'?'Folders':'Problems',simulations:'Visuals',graphs:'Graphs',materials:'Materials'})[t];
  $('#library-title').hidden=t==='problems'&&LIBCOLLECTION==='folders';
  $('#library-title').dataset.i18n=({problems:LIBCOLLECTION==='folders'?'folders':'problems',simulations:'visuals',graphs:'graphs',materials:'materials'})[t];
  $$('#libtabs [data-tab]').forEach(b => { const on = b.dataset.tab === t && (!b.dataset.collection || b.dataset.collection===LIBCOLLECTION); b.classList.toggle('on', on); b.setAttribute('aria-current',on?'page':'false'); });
  $$('#library .pg-pane').forEach(p => { p.hidden = p.dataset.pane !== t; });
  if (t === 'simulations') teacher.openGallery(); else if (teacher.browsing) teacher.closeGallery(false);
  if (t === 'graphs') teacher.loadGraphs($('#libgraphs'));
  if (t === 'materials') teacher.loadMaterials($('#libmaterials'));
  if (t === 'problems') libCollection(LIBCOLLECTION);
}
function renderLibrary() { return workLibrary.enter(); }

/* the older solve flow (Homework page) is gone: screenshots go into any chat. A solve still running from before keeps its view. */
function newChatWith(note) { show('teacher'); teacher.newChat(); if (note) toast(note, 6000); }
function startNextPart() { newChatWith('Paste the next part into the new chat. The earlier parts are in the Library.'); }
function clarify() { newChatWith('Add the extra information in a new chat.'); }
async function followJob(jobId, local) {
  JOB = { id: jobId, info: { text: local.text } };
  sessionStorage.setItem('kinema.job', jobId);
  CURRENT = null; TUTOR = null; resetStage(); KIND = null; SIM = null;
  RETURN = 'library'; show('problem');
  $('#shotview').hidden = false; $('#shotimg').hidden = !local.image; if (local.image) $('#shotimg').src = local.image;
  $('#shotcap').textContent = local.image ? 'The tutor is reading your screenshot.' : local.text.slice(0, 280);
  $('#transport').hidden = true; $('#overlays').hidden = true; $('#readout').hidden = true; $('#stitle').hidden = true; $('#study').hidden = true;
  coach.setLesson(null, {}); coach.st = null;
  coach.setPartial(null, { phase: 'starting', secs: 0 });
  const token = (followJob.token = (followJob.token || 0) + 1);
  for (;;) {
    await sleep(700);
    if (token !== followJob.token) return;
    let j;
    try { j = await api(url('/api/jobs/' + jobId)); } catch (e) {
      if (e.status === 404) { finishJob(); coach.setLesson({ title: 'The solve was interrupted', restatement: 'The server restarted while solving. Your problem was not lost if it finished; check the Library, or solve it again.', steps: [], answers: [], givens: [], assumptions: [], questions: [], status: 'unsupported', visualization: { kind: 'none' } }, {}); return; }
      continue;
    }
    JOB = j;
    if (j.status === 'running') { coach.setPartial(j.partial, j); if (j.partial?.title) $('#shotcap').textContent = j.partial.restatement || j.partial.title; continue; }
    finishJob();
    if (j.status === 'done') {
      const res = j.result;
      $('#shotview').hidden = true;
      const ok = loadResult(res.scene, { id: res.saved_id, image: res.image, text: res.text, warnings: res.warnings, meta: res.meta, thread: [], messages: [], cards: (res.cards_added || []).map(id => ({ id })) });
      if (res.saved_id) { CURRENT = res.saved_id; history.replaceState(null, '', location.pathname + '?problem=' + res.saved_id); refreshThread(res.saved_id); }
      if (ok) toast(`${res.meta?.label || 'Tutor'} · ${Math.round(res.meta?.secs || j.secs)} s`, 4200);
    } else {
      coach.setLesson({ title: j.status === 'cancelled' ? 'Cancelled' : 'The solve failed', restatement: j.error || '', steps: [], answers: [], givens: [], assumptions: [], questions: [], status: 'unsupported', visualization: { kind: 'none' } }, {});
      const host = $('#coach');
      host.insertAdjacentHTML('beforeend', `<div class="acts"><button class="btn p" id="newchat">Start a new chat</button></div>${j.raw ? `<details class="warnings"><summary>What the model returned</summary><pre style="white-space:pre-wrap;font:11px var(--mono)">${esc(j.raw.slice(0, 20000))}</pre></details>` : ''}`);
      $('#newchat').addEventListener('click', () => newChatWith());
    }
    return;
  }
}
function finishJob() { JOB = null; sessionStorage.removeItem('kinema.job'); }
async function cancelJob() { if (!JOB?.id) return; try { await api(url('/api/jobs/' + JOB.id + '/cancel'), { method: 'POST' }); } catch { /* finishing anyway */ } }
async function resumeRunningJob() {
  const id = sessionStorage.getItem('kinema.job');
  try {
    const running = await api('/api/jobs');
    const job = running.find(j => j.id === id && j.kind === 'solve') || running.find(j => j.kind === 'solve');
    if (job) { JOB = job; if (job.id === id) followJob(job.id, { image: job.info?.image, text: job.info?.text || '' }); }
  } catch { /* nothing running */ }
}
function zoom(src) { $('#zoomimg').src = src; $('#zoom').hidden = false; }

// ── opening lessons ───────────────────────────────────────────────────────────────────────────────────────────────
async function openProblem(id) {
  let d;
  try { d = await api(url('/api/problems/' + id)); } catch (e) { toast(e.message); return; }
  if (d.mode === 'template') { location.href = '/classic'; return; }
  followJob.token = (followJob.token || 0) + 1;
  $('#shotview').hidden = true;
  if (loadResult(d.scene, { id, image: d.image, text: d.text, warnings: d.warnings, meta: d.meta, thread: d.thread, messages: d.messages, cards: d.cards, presentation:d.presentation })) {
    CURRENT = id; history.replaceState(null, '', location.pathname + '?problem=' + id);
  }
}
async function refreshThread(id) {
  try { const d = await api(url('/api/problems/' + id)); if (CURRENT === id && d.thread?.length) { coach.ctx.thread = d.thread; coach.ctx.cards = d.cards; if (!coach.asking) { coach.render(); applyStep(coach.currentStep()); } } } catch { /* optional */ }
}
function loadExample(id, e) {
  const go = spec => { CURRENT = null; history.replaceState(null, '', location.pathname); loadResult(spec, { meta: { provider: 'example' }, warnings: [] }); };
  if (e) return go(e.spec);
  api('/api/tutor/examples').then(ex => ex[id] ? go(ex[id].spec) : loadPreset(id)).catch(() => loadPreset(id));
}
function loadPreset(id) {
  if (!PR[id]) return;
  const spec = PR[id](PD[id]), t = PT[id];
  const scene = { ...spec, title: t[0], restatement: t[1], givens: [], unknowns: [],
    steps: [{ title: 'The setup', body: 'Inspect the simulated motion, contacts and joint loads. Press **space** to play, drag the scrubber, or click a body or a string to inspect it.', at: 0, show: ['forces', 'labels', 'tensions'], camera: null, highlight: [], actions: [] },
      { title: 'Watch it move', body: 'The vectors move with the motion. **[** and **]** change the speed; **1–4** switch cameras; drag to orbit and use the wheel to zoom.', at: null, show: ['forces', 'velocity', 'labels', 'tensions', 'trail'], camera: null, highlight: [], actions: [{ type: 'play', from: 0, to: null, speed: 0.5 }] }],
    checks: [], answer: { label: '', value: null, units: '', expression: '', note: '' }, notes: '' };
  CURRENT = null; history.replaceState(null, '', location.pathname);
  loadResult(scene, { meta: { provider: 'example' }, warnings: [] });
}
/* any saved or fresh result: a tutor lesson (any visual) or a legacy planar scene */
function loadResult(result, ctx = {}) {
  STAGE_OWNER = 'problem';
  PLAYING = false; STOP_AT = null; T = 0; STEP = 0; LOOP = false; playIcon();
  $('#shotview').hidden = true; $('#energy').hidden = true; $('#inspector').hidden = true;
  if (result?.kind !== 'tutor') {
    // a legacy planar scene: show it with its own steps as a solution
    if (!loadScene(result, ctx)) return false;
    TUTOR = null;
    const lessonLike = { title: result.title, domain: 'Mechanics', restatement: result.restatement || '', givens: result.givens || [], assumptions: [], questions: [], plan: '', status: 'solved',
      steps: (result.steps || []).map(s => ({ prompt: '', hint: '', result: '', ...s })), answers: result.answer && (result.answer.expression || result.answer.value != null) ? [result.answer] : [], key_ideas: [], visualization: { kind: 'mechanics' } };
    coach.setLesson(lessonLike, ctx); if (coach.mode === 'coach' && !lessonLike.steps.some(s => s.prompt)) coach.st.mode = 'solution';
    coach.render(); coach.setChecks(SCENE._checks, checkSummary(SCENE._checks || []));
    show('problem'); applyStep(0); return true;
  }
  const v = result.visualization || { kind: 'none' };
  TUTOR = result;
  let ok = true;
  if (v.kind === 'mechanics' && v.scene) {
    const combined = { ...v.scene, title: result.title, restatement: result.restatement, steps: result.steps.length ? result.steps : v.scene.steps, answer: result.answers[0] || {} };
    try { ok = loadScene(combined, ctx); } catch (e) { ok = false; ctx = { ...ctx, warnings: [...(ctx.warnings || []), 'The simulation could not be drawn: ' + e.message] }; }
    if (!ok) { TUTOR = { ...result, visualization: { kind: 'none', caption: 'The simulation is unavailable; the worked solution is below.' } }; loadMath(TUTOR); }
  } else if (v.kind === 'rigid3d' && v.rigid3d) {
    try { loadRigid(result, ctx); } catch (e) { ctx = { ...ctx, warnings: [...(ctx.warnings || []), 'The 3D model could not be built: ' + e.message] }; TUTOR = { ...result, visualization: { kind: 'none', caption: 'The 3D model is unavailable; the worked solution is below.' } }; loadMath(TUTOR); }
  } else loadMath(result);
  coach.setLesson(TUTOR, { ...ctx, warnings: [...(ctx.warnings || []), ...(RIGID?.warnings || [])] });
  if (KIND === 'rigid3d' && RIGID) coach.setChecks(RIGID.checks, checkSummary(RIGID.checks));
  else if (KIND === 'mechanics' && SCENE?._checks) coach.setChecks(SCENE._checks, checkSummary(SCENE._checks));
  else if (TUTOR.visualization.kind === 'circuit' && TUTOR.visualization.circuit?.check_results?.length) { const rows = TUTOR.visualization.circuit.check_results; coach.setChecks(rows, checkSummary(rows)); }
  show('problem');
  applyStep(coach.currentStep());
  return true;
}
function loadMath(result) {
  resetStage(); KIND = 'math'; world = null; lesson = null;
  SIM = { duration: result.visualization.kind === 'plot' ? (result.visualization.plot?.duration || 0) : 0 };
  $('#transport').hidden = !(SIM.duration > 0); $('#hint').hidden = true; $('#overlays').hidden = true; $('#readout').hidden = true; $('#stitle').hidden = true;
  STUDY.load(result);
  document.body.classList.add('math-view');
}

// ── the tutor's visual: the same native stage, beside the tutor chat instead of the homework coach ──────────────────
let studioReady; const STUDIO_READY = new Promise(r => { studioReady = r; });
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
function stageHost() {
  return {
    owner: () => STAGE_OWNER,
    reducedMotion: () => REDUCED_MOTION.matches,
    state: () => ({ kind: KIND, t: T, playing: PLAYING, speed: SPEED, duration: STAGE_STILL ? 0 : SIM?.duration || 0, camera: ORBITED ? null : VIEWS.cur || null, forces: nativeForcesVisible(),
      forceIntent:NATIVE_FORCE_INTENT.intent,helpRevealed:NATIVE_FORCE_INTENT.revealed,
      breakdown:nativeBreakdownOn(),breakdownSupported:!!nativeBreakdown(),forceBody:KIND==='mechanics'?OV.forceBody||null:null,forceLoads:KIND==='mechanics'&&OV.loads?[...OV.loads]:null,region:!ORBITED&&VIEWS.cur==='region'?{name:REGION_NAME,...world?.region}:null,breakdownKind:nativeBreakdown()?.kind||null,closeups:nativeCloseups().map(t=>t.name),closeup:!ORBITED&&VIEWS.cur==='closeup'?nativeCloseups().find(closeupMatches)?.name||null:null,
      forcesSupported:KIND==='mechanics'||KIND==='rigid3d'&&!!(RIGID?.sim?.ctx?.g>0||RIGID?.sim?.ctx?.support&&RIGID.sim.ctx.support!=='none'),forceNote:(KIND==='mechanics'?world?.forceNote:RIGID?.forceNote)||'',
      show: KIND === 'rigid3d' ? [...OV3] : KIND === 'mechanics' ? Object.keys(OV).filter(k => OV[k]===true).map(k => k === 'allForces' ? 'all_forces' : k) : [],
      ...(KIND === 'math' ? STUDY.paramState() || {} : {}) }),
    pause() { PLAYING = false; playIcon(); },
      forces: (on,options={})=>setNativeForces(on,true,options.explicit),
    /* bounded calls for an authored chapter view: each returns what actually took effect */
    breakdown(on) { return setNativeBreakdown(!!on) && nativeBreakdownOn(); },
    forceBody(id) { if (KIND !== 'mechanics') return null; setNativeForceBody(id || null); syncNativeForceBody(); return OV.forceBody || null; },
    closeupTarget(target) { return setNativeRegion(target); },
    forceLoads(labels) { return setNativeLoads(labels); },
    reset() { PLAYING=false;setT(STAGE_STILL?Math.min(.5,SIM?.duration||0):0);setNativeForces(NATIVE_FORCE_INTENT.reset());setNativeLoads(null);playIcon(); },
    /* re-run the current view's fit once the pane is laid out (it may have been closed while loading); not per frame */
    refit: refitStage,
    /* a still picture: no play control even when the lesson has frames (library illustrations) */
    still() { STAGE_STILL = true; PLAYING = false; STOP_AT = null; if (KIND === 'mechanics') setT(Math.min(.5, SIM?.duration || 0)); playIcon(); $('#transport').hidden = true; viewLabel(); },
    libraryControls({forces = false} = {}) {
      $('#library-views')?.remove();
      const cams = KIND === 'rigid3d' ? RIGID?.cams : KIND === 'mechanics' ? world?.cams : null;
      if (!cams?.hero && !cams?.side) return;
      const bar = document.createElement('div'); bar.id = 'library-views'; bar.className = 'library-views'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Visual view');
      const support = RIGID?.sim?.ctx;
      const hasForces = KIND === 'mechanics' && forces || KIND === 'rigid3d' && (support?.g > 0 || support?.support && support.support !== 'none');
      // one compact row: what is drawn (Forces, Breakdown), then where the camera looks (Full setup and each named close-up), then Reset
      const breakdown = nativeBreakdown(), subjects = nativeCloseups(cams);
      const choices = [...(hasForces ? [['forces',NATIVE_FORCE_INTENT.label,'Real forces acting on the bodies']] : []),
        ...(breakdown ? [['breakdown','Breakdown',breakdown.title]] : []),
        ...(subjects.length ? [['hero','Full setup','The whole apparatus'], ...subjects.map((t,i) => ['closeup:'+i,t.name,'Close-up that moves with it; Full setup returns'])] : []),
        ['reset','Reset','Back to the start']];
      bar.innerHTML = choices.map(([id,label,title]) => `<button type="button" data-library-view="${esc(id)}" aria-label="${esc(label)}" title="${esc(title)}" aria-pressed="false"${id==='breakdown'?' class="lv-breakdown"':id.startsWith('closeup')?' class="lv-closeup"':id==='hero'?' class="lv-full"':''}>${id==='reset'?controlIcon('reset'):esc(label)}</button>`).join('');
      const forceNote=KIND==='mechanics'?world?.forceNote:RIGID?.forceNote;
      const note=document.createElement('span');note.className='native-force-note';note.textContent=forceNote||'';note.hidden=!forceNote;bar.appendChild(note);
      const choice=new Set(world?.forceChoices||[]),bodies=KIND==='mechanics'?(SCENE?.bodies||[]).filter(b=>world?.forceChoices?choice.has(b.id):b.type!=='static'):[];
      if(hasForces&&bodies.length>1) {
        const select=document.createElement('select');select.setAttribute('aria-label','Forces on body');select.className='native-force-body';
        // which body's forces: a choice of what is drawn, not of the camera (named close-ups are buttons above)
        select.innerHTML='<option value="">All bodies</option>'+bodies.map(b=>`<option value="${esc(b.id)}">${esc(b.name||b.label||b.id)}</option>`).join('');
        select.value=validNativeForceBody(OV.forceBody)||'';
        select.onchange=()=>{setNativeForceBody(select.value);select.value=OV.forceBody||'';};bar.appendChild(select);
      }
      bar.onclick = e => { const b = e.target.closest('[data-library-view]'); if (!b) return; const v = b.dataset.libraryView;
        if (v === 'forces') setNativeForces(!nativeForcesVisible(),true,true);
        else if (v === 'breakdown') setNativeBreakdown(!nativeBreakdownOn());
        else if (v === 'reset') { PLAYING=false;setT(STAGE_STILL?Math.min(.5,SIM?.duration||0):0);setNativeForces(NATIVE_FORCE_INTENT.reset());setNativeLoads(null);if(nativeBreakdownOn())setNativeBreakdown(false);playIcon(); }
        else if (v.startsWith('closeup:')) { const t = nativeCloseups(cams)[+v.slice(8)]; if (t?.type === 'spring') selectTeachingTarget(t); else { if (SEL?.type === 'spring') { SEL = null; world?.select(null); } setCamera('closeup', true); } }
        else { if (v === 'hero' && SEL?.type === 'spring') { SEL = null; world?.select(null); } setCamera(v); }
        syncLibraryControls();
      }; $('#stage').before(bar);
      if (hasForces) setNativeForces(NATIVE_FORCE_INTENT.on, false);
      setCamera(cams.hero ? 'hero' : 'side'); syncLibraryControls();
    },
    /* a decorative library prop alone on the stage, for inspection only: no physics, no transport, no key.
       Resolves {ok, kind:'prop', title}, {ok:false, error} or {ok:false, cancelled} when live() turned false
       at an await (nothing on the stage changed then); never switches view. */
    async loadProp(id, key, { live } = {}) {
      const gone = () => live && !live();
      await STUDIO_READY; if (gone()) return { ok: false, cancelled: true };
      let lib = null; if (studio) try { lib = await import('./prop_library.js'); } catch { }
      if (gone()) return { ok: false, cancelled: true };
      STAGE_QUIET = true; STAGE_OWNER = null;
      try {
        if (!studio) throw new Error('3D is unavailable in this browser.');
        if (!lib) throw new Error('The prop library is not installed in this build.');
        const def = (lib.PROP_DEFS || []).find(d => d.id === id); if (!def) throw new Error('No prop called "' + id + '" in this build.');
        PLAYING = false; STOP_AT = null; T = 0; playIcon();
        resetStage(); KIND = 'prop'; cameraMoveMode(false); TUTOR = null; SCENE = null; SIM = { duration: 0 };
        const group = lib.createProp(id, {}); PROP = { group, dispose: () => lib.disposeProp ? lib.disposeProp(group) : null };
        studio.scene.add(group); studio.resize();
        const b = group.userData.bounds || {}, c = new THREE.Vector3(...(b.center || [0, 0, 0])), r = Math.max(1e-3, b.radius || 1);
        const size = b.size ? Math.max(...b.size) : 2 * r;
        studio.frame(c, size, false); studio.setFloorY(c.y - (b.size ? b.size[1] / 2 : r));
        const fov = THREE.MathUtils.degToRad(studio.camera.fov || 40), dist = r / Math.sin(Math.min(fov, fov * studio.camera.aspect) / 2) * 1.4;   // some air around it, and room for the stage's own corner controls
        studio.moveCamera(c.clone().add(new THREE.Vector3(0.62, 0.42, 0.66).normalize().multiplyScalar(dist)), c, 0); VIEWS.cur = null; ORBITED = false;
        $('#transport').hidden = true; $('#hint').hidden = true; $('#overlays').hidden = true; $('#readout').hidden = true; $('#energy').hidden = true; $('#inspector').hidden = true;
        $('#stitle').hidden = false; $('#skicker').textContent = 'Prop · static, not simulated'; $('#title').textContent = def.title || id;
        STAGE_OWNER = key;
        return { ok: true, kind: 'prop', motion: false, title: def.title || id };
      } catch (e) { resetStage(); KIND = null; SIM = null; return { ok: false, error: e.message || String(e) }; }
      finally { STAGE_QUIET = false; }
    },
    /* result: a validated tutor lesson or planar scene. Resolves {ok, kind, motion}, {ok:false, error} or
       {ok:false, cancelled} when live() turned false while waiting (stage untouched); never switches view. */
    async load(result, key, { live, prepared, intent='learn',onHelpReveal } = {}) {
      await STUDIO_READY; if (live && !live()) return { ok: false, cancelled: true };
      STUDY.prepared = !!prepared;   // an authored guide figure (not a model's proposal)
      STAGE_QUIET = true; STAGE_OWNER = null;
      try {
        PLAYING = false; STOP_AT = null; T = 0; STEP = 0; LOOP = false; playIcon();
        $('#shotview').hidden = true; $('#energy').hidden = true; $('#inspector').hidden = true;
        let kind;
        const need3d = () => { if (!studio) throw new Error('3D is unavailable in this browser.'); };
        if (result?.kind !== 'tutor') {
          need3d(); if (!loadScene(result, {})) throw new Error('This scene has no bodies to draw.');
          TUTOR = null; kind = 'mechanics';
        } else {
          const v = result.visualization || { kind: 'none' }; TUTOR = result;
          if (v.kind === 'mechanics' && v.scene) {
            need3d();
            const combined = { ...v.scene, title: result.title, restatement: result.restatement, steps: result.steps?.length ? result.steps : v.scene.steps, answer: (result.answers || [])[0] || {} };
            if (!loadScene(combined, {})) throw new Error('This scene has no bodies to draw.');
            kind = 'mechanics';
          } else if (v.kind === 'rigid3d' && v.rigid3d) { need3d(); loadRigid(result, {}); kind = 'rigid3d'; }
          else if (v.kind && v.kind !== 'none') { loadMath(result); STUDY.setStep(result.steps?.[0] || {}); kind = v.kind; }
          else throw new Error('This explanation has no visual to draw.');
        }
        if (VIEW === 'teacher') document.body.classList.toggle('math-view', KIND === 'math');
        NATIVE_FORCE_INTENT=createForceIntent({intent,onHelpReveal});setNativeForces(NATIVE_FORCE_INTENT.on,false);
        if (kind==='mechanics' || kind==='rigid3d') this.libraryControls({forces:kind==='mechanics'});
        STAGE_OWNER = key;
        return { ok: true, kind, motion: SIM?.duration > 0, warnings: kind==='mechanics'?SCENE?._ctx?.warnings||[]:RIGID?.warnings||[] };
      } catch (e) { resetStage(); KIND = null; SIM = null; return { ok: false, error: e.message || String(e) }; }
      finally { STAGE_QUIET = false; }
    },
    /* view: {show, focus, playing, time, camera, parameters}; only what the tutor names changes */
    apply(view = {}) {
      if (KIND === 'math' && view.parameters && typeof view.parameters === 'object') STUDY.setParameters(view.parameters);
      const layers = Array.isArray(view.show) && view.show.length ? view.show : null;
      if (KIND === 'rigid3d' && RIGID) { if (layers) { OV3 = nativeRigidLayers(layers); renderChips(); } }
      else if (KIND === 'mechanics' && world) { if (layers) setOverlays(layers); if (view.focus) { STEP_FOCUS = view.focus; world.setFocus(view.focus); } }
      if (view.camera && (view.camera !== VIEWS.cur || ORBITED)) setCamera(view.camera);
      if (Number.isFinite(view.time)) setT(view.time);
      PLAYING = !STAGE_STILL && !!view.playing && SIM?.duration > 0 && !REDUCED_MOTION.matches; STOP_AT = null; LAST = performance.now(); playIcon();
      return { playing: PLAYING };
    },
  };
}

function nativeForcesVisible() { return KIND === 'mechanics' ? OV.forces !== false : KIND === 'rigid3d' ? OV3.has('weight') || OV3.has('contact') : false; }
function nativeRigidLayers(layers) { return new Set([...layers.filter(k=>!['weight','contact','forces'].includes(k)), 'labels', ...(nativeForcesVisible() ? ['weight','contact'] : [])]); }
function setNativeForces(on = true, preserveCamera = true, explicit = false) {
  on=NATIVE_FORCE_INTENT.set(on,{explicit});
  if (nativeForcesVisible() !== !!on) FORCE_KEY_CHANGE = preserveCamera;
  if (KIND === 'mechanics') { OV = { ...OV, forces: !!on, tensions: !!on, allForces: true, labels: true }; planarChips(); }
  else if (KIND === 'rigid3d') { for (const k of ['weight','contact']) on ? OV3.add(k) : OV3.delete(k); renderChips(); }
  syncLibraryControls(); return nativeForcesVisible();
}
function syncLibraryControls() {
  const subjects = nativeCloseups();
  $('#library-views')?.querySelectorAll('[data-library-view]').forEach(b => { const v = b.dataset.libraryView;
    const on = v === 'forces' ? nativeForcesVisible() : v === 'breakdown' ? nativeBreakdownOn() : v.startsWith('closeup:') ? !ORBITED && VIEWS.cur === 'closeup' && closeupMatches(subjects[+v.slice(8)]) : !ORBITED && v === VIEWS.cur;
    b.setAttribute('aria-pressed', String(on)); if (v === 'forces') b.textContent = NATIVE_FORCE_INTENT.label; });
}
/* Breakdown: the setup's own components and equations (teaching_views / rigid r x F), separate from the raw Forces layer.
   Off by default; a force breakdown asks for the forces too, through the same explicit reveal as the Forces button. */
function nativeBreakdown() {
  if (KIND === 'mechanics' && world?.breakdown) return { ...world.breakdown, title: 'Split the forces into components along the natural axes, with the equations' };
  if (KIND === 'rigid3d' && RIGID?.gravityTorque) return { kind: 'torque', needsForces: false, title: 'Gravity torque τ = r × F about the pivot' };
  return null;
}
function nativeBreakdownOn() { return KIND === 'mechanics' ? !!OV.breakdown : KIND === 'rigid3d' ? OV3.has('gravity_torque') : false; }
function setNativeBreakdown(on) {
  const b = nativeBreakdown(); if (!b) return false;
  if (on && b.needsForces && !nativeForcesVisible()) setNativeForces(true, true, true);
  if (KIND === 'mechanics') { OV = { ...OV, breakdown: !!on }; FORCE_KEY_CHANGE = true; }
  else { on ? OV3.add('gravity_torque') : OV3.delete('gravity_torque'); renderChips(); }
  syncLibraryControls(); return nativeBreakdownOn();
}
/* the named subjects a close-up can look at: the focus body (or a rigid body's main part) and any part a Breakdown explains alone */
function nativeCloseups(cams = KIND === 'rigid3d' ? RIGID?.cams : world?.cams) {
  if (!cams?.closeup) return [];
  if (KIND === 'mechanics') return world?.closeups || [];
  if (KIND === 'rigid3d') return [{ type: 'body', name: (RIGID?.closeupName || 'Close-up') + ' close-up' }];
  return [];
}
function closeupMatches(t) { return !!t && (t.type === 'spring' ? SEL?.type === 'spring' && SEL.id === t.id : SEL?.type !== 'spring'); }
function syncNativeForceNote() {
  const note=$('#library-views')?.querySelector?.('.native-force-note');if(!note)return;
  const text=(KIND==='mechanics'?world?.forceNote:RIGID?.forceNote)||'';
  if(note.textContent!==text) { note.textContent=text;note.hidden=!text;FORCE_KEY_CHANGE=true; }
}
function validNativeForceBody(id) { const ok=world?.forceSubjects||(SCENE?.bodies||[]).filter(b=>b.type!=='static').map(b=>b.id); return id&&ok.includes(id)?id:null; }
function syncNativeForceBody() { const s=$('#library-views')?.querySelector?.('.native-force-body'); if(s)s.value=[...s.options].some(o=>o.value===(OV.forceBody||''))?OV.forceBody||'':''; }
/* a still close-up on a named place (an authored chapter view: where a chain wraps its guide); bounded by scene3d to the setup;
   it is an explicit choice like a view button, and a later orbit or view leaves it (the learner keeps the camera) */
/* which authored applied loads are drawn (exact spec.forces labels; null = all). Display only: the physics, other force
   kinds and the values are untouched; unknown labels are dropped and a list naming none of the scene's loads changes nothing.
   Reset and a new scene clear it. Returns the filter now in effect. */
function setNativeLoads(labels) {
  if (KIND !== 'mechanics') return null;
  const known = new Set((SCENE?.forces || []).map(f => f.label).filter(Boolean));
  const next = labels == null ? null : [...new Set([].concat(labels).map(String).filter(l => known.has(l)))];
  if (next && !next.length) return OV.loads ? [...OV.loads] : null;
  if (String(next) !== String(OV.loads || null)) { FORCE_KEY_CHANGE = true; call?.pruneKey?.(); }
  OV = { ...OV, loads: next }; return next ? [...next] : null;
}
let REGION_NAME = '';
function setNativeRegion({point, size, name} = {}) {
  if (KIND !== 'mechanics' || !world?.setRegion || !studio || !world.setRegion(point, size)) return false;
  REGION_NAME = String(name || 'Close-up').slice(0, 40); setCamera('region'); return true;
}
function setNativeForceBody(id) { const body=validNativeForceBody(id);if(body!==(OV.forceBody||null)){FORCE_KEY_CHANGE=true;call?.pruneKey?.();}OV.forceBody=body; }

// ── the stage: planar mechanics ───────────────────────────────────────────────────────────────────────────────────
function resetStage() {
  STAGE_STILL = false; FORCE_KEY_CHANGE = false;
  OV.forceBody=null; OV.breakdown=false; OV.loads=null;
  NATIVE_FORCE_INTENT=createForceIntent();
  $('#library-views')?.remove();
  if (RIGID) { RIGID.dispose(); RIGID = null; }
  if (PROP) { studio?.scene.remove(PROP.group); PROP.dispose(); PROP = null; }
  if (studio && world) { for (const o of [...studio.scene.children]) if (!o.isLight && o !== studio.floor && !(o.geometry && o.geometry.type === 'SphereGeometry' && o.geometry.parameters.radius > 500)) studio.scene.remove(o); }
  world = null; lesson = null;
  if (call) call.clear(); $('#inspector').hidden = true; SEL = null; HL = [];
  STUDY?.hide(); document.body.classList.remove('math-view');
}
function loadScene(scene, ctx) {
  if (!studio) { if (!STAGE_QUIET) toast('3D is unavailable in this browser.'); return false; }
  if (!scene || !(scene.bodies || []).length) { if (!STAGE_QUIET) toast('This saved scene has no bodies.'); return false; }
  const spec = { ...scene }; delete spec._ctx; delete spec._checks;
  let sim; try { sim = E.simulate(spec); } catch (e) { if (STAGE_QUIET) throw e; toast('The engine could not run this scene: ' + (e.message || e), 6000); return false; }
  const keepSpeed = KIND === 'mechanics' && SCENE === scene;
  resetStage(); if (!keepSpeed) { SPEED = 1; $('#spd').textContent = speedLabel(SPEED); } KIND = 'mechanics'; cameraMoveMode(false); SCENE = scene; SCENE._ctx = ctx; SIM = sim;
  if (!STAGE_QUIET) show('problem'); studio.resize();
  world = buildScene(studio, spec, SIM);
  if (world.warnings?.length) ctx.warnings = [...(ctx.warnings || []),...world.warnings];
  studio.frame(world.bounds.center, world.bounds.size, !!spec.topdown); if (!spec.topdown) studio.setFloorY(world.bounds.floorY);
  lesson = new Lesson({ studio, world, spec, sim: SIM, E, getT: () => T, setT: t => setT(t), setPlaying: (on, stopAt, speed) => { PLAYING = on; STOP_AT = stopAt; if (speed) { SPEED = speed; $('#spd').textContent = SPEED + '×'; } LAST = performance.now(); playIcon(); }, setOverlays, setHighlight: items => { HL = items || []; }, setFocus: id => { STEP_FOCUS = id; world.setFocus(id); }, setSelected: s => { SEL = s; }, cams: () => new Proxy(world.cams, { get: (o, k) => { if (typeof k === 'string' && o[k]) { VIEWS.cur = k; viewLabel(); } return o[k]; } }) });
  $('#stitle').hidden = false; $('#skicker').textContent = 'Simulation · planar rigid bodies'; $('#title').textContent = scene.title;
  $('#transport').hidden = false; $('#hint').hidden = false; $('#readout').hidden = true; setNativeForces(true, false); planarChips();
  { const [eye, tg] = world.cams[scene.camera || world.defaultView](); studio.moveCamera(eye, tg, 0); VIEWS.cur = null; ORBITED = false; viewLabel(); }   // fit after the transport is laid out
  T = 0; PLAYING = false; STOP_AT = null; playIcon(); SCENE._checks = runChecks(); renderMarkers(scene.steps);
  window.__world = world; window.__studio = studio; window.__lesson = lesson;
  return true;
}
function setOverlays(list) { const L = new Set(list || []), force = NATIVE_FORCE_INTENT.on; OV = { forceBody:validNativeForceBody(OV.forceBody), forces: force, labels: true, tensions: force, velocity: L.has('velocity'), trail: L.has('trail'), allForces: true, energy: L.has('energy'), axes: L.has('axes'), breakdown: L.has('breakdown') || !!OV.breakdown, loads: OV.loads || null }; $('#energy').hidden = !OV.energy; planarChips(); }
/* planar scenes: the only student layer control is the problem's own axes, offered when the renderer can draw them (frames.plane) */
function planarChips() {
  const el = $('#overlays'); if (KIND !== 'mechanics' || !world) return;
  el.hidden = !world.frames?.plane; if (el.hidden) return;
  el.innerHTML = `<button data-ov="axes" class="${OV.axes ? 'on' : ''}" title="The problem's x and y in the plane at the origin; z points out of the screen"><i style="background:${hex(PALETTE.axes[0])}"></i>axes x y z ⊙</button>`;
  el.firstChild.addEventListener('click', () => { OV.axes = !OV.axes; planarChips(); if (OV.axes) requestAnimationFrame(refitStage); });
}

// ── the stage: 3D rigid bodies ────────────────────────────────────────────────────────────────────────────────────
const RIGID_DEFAULT = ['omega', 'L', 'torque', 'weight', 'contact', 'axis', 'vertical', 'trace', 'trace_contact', 'labels'];
/* Native scenes start with drag-to-orbit; Move explicitly switches to pan.
   Forces are independent. Resize retains a manual view's relative zoom and aim. */
function initCameraControls() {
  const hint = $('#hint'); hint.classList.add('camera-tools');
  hint.innerHTML = '<button type="button" data-camera-tool="out" aria-label="Zoom out" title="Zoom out">−</button><button type="button" data-camera-tool="in" aria-label="Zoom in" title="Zoom in">+</button><button type="button" data-camera-tool="move" aria-pressed="false" title="Drag to move the view instead of orbiting">Move</button><button type="button" data-camera-tool="fit" title="Fit the whole setup">Fit</button>';
  hint.querySelector('[data-camera-tool=in]').innerHTML=zoomGlyph(true);
  hint.querySelector('[data-camera-tool=out]').innerHTML=zoomGlyph(false);
  const zoom=document.createElement('div');zoom.className='viewer-zoom';zoom.setAttribute('role','group');zoom.setAttribute('aria-label','Zoom');
  zoom.append(hint.querySelector('[data-camera-tool=out]'),hint.querySelector('[data-camera-tool=in]'));
  hint.prepend($('#views'),zoom);
  hint.addEventListener('click', e => {
    const action = e.target.closest('[data-camera-tool]')?.dataset.cameraTool; if (!action || !studio) return;
    if (action === 'move') { cameraMoveMode(studio.controls.mouseButtons.LEFT !== THREE.MOUSE.PAN); return; }
    if (action === 'fit') { ORBITED = false; setCamera(VIEWS.cur || (KIND === 'mechanics' ? (SCENE?.camera || world?.defaultView || (SCENE?.topdown ? 'top' : 'side')) : RIGID?.defaultView || 'hero'));  return; }
    const c = studio.camera, target = studio.controls.target.clone(), delta = c.position.clone().sub(target);
    const next = Math.max(studio.controls.minDistance, Math.min(studio.controls.maxDistance, delta.length() * (action === 'in' ? 0.8 : 1.25)));
    studio.moveCamera(target.clone().add(delta.setLength(next)), target, 0); ORBITED = true; viewLabel();
  });
}
function cameraMoveMode(move) {
  if (!studio) return;
  studio.controls.mouseButtons.LEFT = move ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  studio.controls.touches.ONE = move ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  studio.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  const button = $('#hint [data-camera-tool="move"]');
  if (button) { button.setAttribute('aria-pressed', String(move)); button.title = move ? 'Drag moves the view. Turn off to orbit.' : 'Drag to move the view instead of orbiting'; }
}
const CHIP = [['omega', 'ω', PALETTE.omega], ['L', 'L', PALETTE.tension], ['torque', 'τ = dL/dt', PALETTE.applied], ['forces', 'forces', PALETTE.weight], ['trace', 'traces', PALETTE.ink2], ['axes', 'axes', PALETTE.axes[0]], ['labels', 'labels', PALETTE.ink]];
/* coordinate frames, when the view offers them: the problem's fixed x y z, and x′ y′ z′ turning with the body
   (not necessarily principal). The older 'axes' chip keeps its name: it draws spin axis, vertical and principal axes together */
const FRAME_CHIPS = [['world_axes', 'world x y z', 'Fixed world frame x, y, z (does not move)'], ['body_axes', 'body x′ y′ z′', 'Body axes x′, y′, z′, turning with the body; not necessarily principal']];
function loadRigid(result, ctx) {
  if (!studio) throw new Error('3D is unavailable in this browser');
  resetStage(); KIND = 'rigid3d';
  const spec = result.visualization.rigid3d;
  RIGID = buildRigid(studio, spec);
  world = null; lesson = null; SCENE = null;
  SIM = { duration: RIGID.duration };
  if (!STAGE_QUIET) show('problem'); studio.resize();
  studio.frame(RIGID.bounds.center, RIGID.bounds.size * 0.6, false); studio.setFloorY(0);
  REFS3 = !!spec.references?.length;   // teaching references (axis, origin, slice, distance) get their own layer chip
  OV3 = new Set([...(spec.show?.length ? spec.show : REFS3 ? [...RIGID_DEFAULT, 'references'] : RIGID_DEFAULT), 'labels', 'weight', 'contact']);
  renderChips();
  $('#stitle').hidden = false; $('#skicker').textContent = '3D model · ' + (RIGID.sim.mode.replace('_', ' ')); $('#title').textContent = result.title;
  $('#transport').hidden = !(SIM.duration > 0); $('#hint').hidden = false; $('#overlays').hidden = false; $('#readout').hidden = false; cameraMoveMode(false);
  { const [eye, tg] = RIGID.cams[RIGID.defaultView](); studio.moveCamera(eye, tg, 0); VIEWS.cur = null; ORBITED = false; viewLabel(); }   // fit after the transport is laid out (the renderer measures it)
  // real time is too fast to see a 50 rad/s spin: start in slow motion (the transport says how slow)
  T = 0; LOOP = true; SPEED = SPEEDS.reduce((best, s) => Math.abs(Math.log(s / RIGID.naturalSpeed)) < Math.abs(Math.log(best / RIGID.naturalSpeed)) ? s : best, 1); $('#spd').textContent = speedLabel(SPEED);
  PLAYING = false; LAST = performance.now(); playIcon();
  renderMarkers(result.steps);
  window.__rigid = RIGID;
}
function renderChips() {
  syncLibraryControls();
  const el = $('#overlays');
  const frames = RIGID?.frames || {};   // the legacy 'axes' chip keeps its name: it toggles spin axis, vertical and principal axes together
  const chips = [...CHIP.slice(0, -2), [...CHIP.at(-2), 'Spin axis, vertical and principal axes of inertia'],
    ...FRAME_CHIPS.filter(([k]) => frames[k.split('_')[0]]).map(([k, label, title]) => [k, label, PALETTE.ink2, title]),
    ...(RIGID?.gravityTorque ? [['gravity_torque', 'r × F', TEACH.tau]] : []),
    ...(REFS3 ? [['references', 'references', PALETTE.highlight]] : []), CHIP.at(-1)];
  el.innerHTML = chips.map(([k, label, c, title]) => { const on = k === 'labels' ? OV3.has('labels') : (OVERLAY_GROUPS[k] || [k]).some(x => OV3.has(x)); return `<button data-ov="${k}" class="${on ? 'on' : ''}"${title ? ` title="${esc(title)}"` : ''}><i style="background:${hex(c)}"></i>${esc(label)}</button>`; }).join('');
  el.querySelectorAll('[data-ov]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.ov, members = k === 'labels' ? ['labels'] : OVERLAY_GROUPS[k] || [k];
    if (k === 'forces') { setNativeForces(!nativeForcesVisible(),true,true); return; }
    const on = members.some(x => OV3.has(x));
    for (const m of members) on ? OV3.delete(m) : OV3.add(m);
    renderChips();
  }));
}

// ── steps drive the stage ─────────────────────────────────────────────────────────────────────────────────────────
function applyStep(i) {
  const L = coach.lesson; if (!L || !L.steps?.length) return;
  STEP = clamp(i, 0, L.steps.length - 1); const st = L.steps[STEP];
  const view=coach.stepView(STEP);artifact.setStep(view);
  if(artifact.teaching) return;
  if (KIND === 'mechanics' && world && lesson) {
    SEL = null; $('#inspector').hidden = true; world.select(null); STEP_FOCUS = null; world.setFocus(SCENE.focus); HL = [];
    try { lesson.apply(st); } catch (e) { (window.__errs = window.__errs || []).push('step: ' + e.message); }
  } else if (KIND === 'rigid3d' && RIGID) {
    if (Array.isArray(st.show)) { OV3 = nativeRigidLayers(st.show); renderChips(); }
    if (st.camera) setCamera(st.camera);
    if (st.at != null) { setT(st.at); PLAYING = false; playIcon(); }
    for (const a of st.actions || []) {
      if (a.type === 'pause_at' && a.t != null) { setT(a.t); PLAYING = false; playIcon(); }
      if (a.type === 'play') { setT(a.from || 0); SPEED = Math.min(a.speed || 0.5, RIGID.naturalSpeed * 2); $('#spd').textContent = speedLabel(SPEED); STOP_AT = a.to ?? null; PLAYING = true; LAST = performance.now(); playIcon(); }
      if (a.type === 'show' && a.overlays) { OV3 = nativeRigidLayers(a.overlays); renderChips(); }
      if (a.type === 'camera' && a.view) setCamera(a.view);
      if (a.type === 'highlight') HL = a.items || [];
    }
  } else if (KIND === 'math') {
    PLAYING = false; playIcon(); if (st.at != null) setT(st.at);
    for (const a of st.actions || []) { if (a.type === 'pause_at') setT(a.t); if (a.type === 'play' && SIM.duration > 0) { setT(a.from || 0); SPEED = a.speed || 0.5; STOP_AT = a.to ?? SIM.duration; PLAYING = true; LAST = performance.now(); playIcon(); } }
    STUDY.setStep(st);
  }
}
function renderMarkers(steps) { const bar = $('#bar'); bar.querySelectorAll('s').forEach(s => s.remove()); for (const st of steps || []) if (st.at != null && SIM?.duration > 0) { const s = document.createElement('s'); s.style.left = (100 * st.at / SIM.duration).toFixed(2) + '%'; bar.appendChild(s); } }
const VIEWS = ['hero', 'closeup', 'follow', 'side', 'top'];
/* the view menu's names; close-up frames the focus body and moves with it, so the rest of the setup can be off screen */
const VIEW_NAMES = { geometry: ['Square geometry', '', 'Face-on view of the bead geometry'], hero: ['Full setup', '1', 'The whole apparatus and its motion'], closeup: ['Close-up', '5', 'The focus body, larger, moving with it; the rest of the setup may be off screen'],
  follow: ['Follow', '2', 'Moves with the focus body at a wider distance'], side: ['Side', '3', 'Side-on view of the motion plane'], top: ['Top', '4', 'From above'] };
/* re-run the current view's fit once the stage chrome is laid out (pane opened late, Layers panel or axes key shown);
   a camera the learner has orbited is kept. Event-driven only, never per frame. */
function refitStage() {
  if (!studio) return; studio.resize(); if (ORBITED) return;
  const cams = KIND === 'rigid3d' ? RIGID?.cams : KIND === 'mechanics' ? world?.cams : null; if (!cams) return;
  const v = VIEWS.cur && cams[VIEWS.cur] ? VIEWS.cur : KIND === 'rigid3d' ? RIGID.defaultView : SCENE?.camera || world.defaultView;
  const [eye, tg] = cams[v](); studio.moveCamera(eye, tg, 0);
}
/* the stage box really changed (pane opened, expanded, closed to a phone sheet, window resized): a scene fitted while the
   stage was hidden or another size used the wrong aspect, so fit it again; a hidden stage (0 × 0) waits until it shows */
let STAGE_BOX = '', STAGE_REFIT = null;
function stageResized() {
  if (!studio) return; const st = $('#stage'), box = st.clientWidth + 'x' + st.clientHeight;
  if (!st.clientWidth || !st.clientHeight) { STAGE_BOX = ''; return; }   // reshown at its old size it still refits: a scene may have loaded while hidden
  if (box === STAGE_BOX) return;
  STAGE_BOX = box;
  if (STAGE_REFIT == null) STAGE_REFIT = requestAnimationFrame(() => { STAGE_REFIT = null; refitStage(); });
}
function setCamera(v, say) {
  const cams = KIND === 'rigid3d' ? RIGID?.cams : world?.cams; if (!cams || !cams[v] || !studio) return; const [eye, tg] = cams[v](); studio.moveCamera(eye, tg, 600); VIEWS.cur = v; ORBITED = false; viewLabel();
  if (v === 'closeup' && PLAYING) { PLAYING = false; playIcon(); }
  if (say) { const t = v === 'closeup' && nativeCloseups().find(closeupMatches); toast(v === 'closeup' ? (t ? t.name : 'Close-up') + ': moves with it; some of the setup is off screen. Full setup returns.' : 'View: ' + VIEW_NAMES[v][0], v === 'closeup' ? 2600 : 900); }
}
function cycleCamera(){
  const cams=KIND==='rigid3d'?RIGID?.cams:world?.cams;
  const current=VIEWS.cur||(KIND==='rigid3d'?RIGID?.defaultView:SCENE?.camera||world?.defaultView);
  const next=nextView(VIEWS.filter(v=>cams?.[v]),current);if(next)setCamera(next);
}
// A stable current label and next-view tooltip, shared with prepared scenes.
function viewLabel() {
  syncLibraryControls();
  if ($('#hint')?.classList.contains('camera-tools')) {
    const parent = $('#transport').hidden ? $('#stage') : $('#transport');
    if ($('#hint').parentElement !== parent) parent.append($('#hint'));
  }
  const cams = KIND === 'rigid3d' ? RIGID?.cams : world?.cams, cur = VIEWS.cur || (KIND === 'rigid3d' ? RIGID?.defaultView : SCENE?.camera || world?.defaultView);
  const b = $('#views'), name = ORBITED ? 'Custom' : cur === 'region' ? REGION_NAME || 'Close-up' : cams && VIEW_NAMES[cur] ? VIEW_NAMES[cur][0] : 'View';
  const next=nextView(VIEWS.filter(v=>cams?.[v]),cur);cycleLabel(b,name,VIEW_NAMES[next]?.[0]||name);b.hidden=!next;b.removeAttribute('aria-haspopup');b.removeAttribute('aria-expanded');
}
function setT(t) { T = clamp(t, 0, SIM ? SIM.duration : 0); }
function togglePlay() { if (STAGE_STILL || !(SIM?.duration > 0)) return; if (!PLAYING && T >= SIM.duration - 1e-6) T = 0; PLAYING = !PLAYING; STOP_AT = null; LAST = performance.now(); playIcon(); }
function playIcon() { const b=$('#playbtn');b.innerHTML=controlIcon(PLAYING?'pause':'play');b.setAttribute('aria-label',PLAYING?'Pause':'Play'); }
function stepFrame(dir) { if (STAGE_STILL) return; PLAYING = false; playIcon(); setT(T + dir / 60); }
const SPEEDS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2];
function speedLabel(s) { return s >= 0.1 ? s + '×' : '1/' + Math.round(1 / s) + '×'; }
function setSpeed(dir) { let i = SPEEDS.findIndex(x => x >= SPEED - 1e-9); if (i < 0) i = 6; i = clamp(i + dir, 0, SPEEDS.length - 1); SPEED = SPEEDS[i]; $('#spd').textContent = speedLabel(SPEED); }
function advance(now) {
  if (PLAYING && SIM?.duration > 0) {
    T += Math.min(0.1, (now - LAST) / 1000) * SPEED;
    if (STOP_AT != null && T >= STOP_AT) { T = STOP_AT; PLAYING = false; STOP_AT = null; playIcon(); }
    else if (T >= SIM.duration) { if (LOOP) T = T % SIM.duration; else { T = SIM.duration; PLAYING = false; playIcon(); } }
  }
  LAST = now;
}
function updateTransport() { const p = SIM?.duration ? 100 * T / SIM.duration : 0; $('#tbar').style.width = p + '%'; $('#tknob').style.left = p + '%'; $('#tlab').textContent = `${T.toFixed(2)} / ${(SIM?.duration || 0).toFixed(2)} s`; $('#bar').setAttribute('aria-valuenow', T); $('#bar').setAttribute('aria-valuemax', SIM?.duration || 0); }

// ── frame loop ────────────────────────────────────────────────────────────────────────────────────────────────────
let lastReadout = 0;
function loop(now) {
  try {
    if (VIEW === 'problem' || VIEW === 'teacher' || VIEW === 'library') frame(now);
    else LAST = now;
  } catch (e) { (window.__errs = window.__errs || []).push('frame: ' + (e.message || e)); }
  requestAnimationFrame(loop);
}
function frame(now) {
  // Prepared scenes and teaching figures own their rendering; only a visible native stage runs here.
  if (!artifact?.active || !artifact.opened || artifact.teaching || artifact.pane.hidden || artifact.stage.hidden) { LAST = now; return; }
  advance(now);
  if (KIND === 'math') { STUDY.draw(T); updateTransport(); return; }
  if (!studio) return;
  if (KIND === 'mechanics' && world) {
    const fr = E.frameAt(SIM, T); const values = $('#problem-artifact').classList.contains('show-details'); const st = world.update(fr, { ...OV, values });syncNativeForceNote();
    const extra = lesson ? lesson.tick(now) : [];
    inspectorMech(fr); energy(fr); formula();
    // Labels are placed after the render's camera update, from the same camera, so they cannot lag their arrows.
    studio.render(now); drawLabels(st.labels.concat(extra), OV.labels, world.focus(), values);
    updateTransport(); window.__state = { t: T, frame: fr };
  } else if (KIND === 'rigid3d' && RIGID) {
    const st = RIGID.update(T, OV3);
    if(VIEW === 'problem' && coach.stepView(STEP)?.mode==='geometry' && OV3.has('labels')) {
      const point=v=>new THREE.Vector3(v[0],v[2],-v[1]);
      st.labels.push({key:'geo|pivot',label:'Ground pivot',tip:point(st.d.pw),color:0xa9b8c7,plain:true});
      if(st.d.contact)st.labels.push({key:'geo|contact',label:'Wheel contact',tip:point(st.d.contact),color:0x72d6bb,plain:true});
    }
    if (now - lastReadout > 120) { lastReadout = now; readout(); inspectorRigid(); }
    studio.render(now); drawLabels(st.labels, OV3.has('labels'), RIGID.focus(), false);
    updateTransport();
  } else if (KIND === 'prop' && PROP) { studio.render(now); }
}
const sub12 = x => String(x).replace(/[₁₂]/g, m => ({ '₁': '1', '₂': '2' })[m]);
/* One keyed label controller (stage_labels.js): glyphs track their arrow tips exactly, drafting text stays pinned,
   full names sit in the stage key. Values appear in the key only for planar scenes (3D has its readout). */
function drawLabels(labels, showLabels, center, values) {
  const W = studio.renderer.domElement.clientWidth, H = studio.renderer.domElement.clientHeight;
  call.update(labels.map(L => L.glyph != null || L.slot || L.plain || L.formula || L.pin ? L : { ...L, glyph: texName(String(L.label || '').split(' = ')[0].trim()) }), { show: showLabels, values, compactKey: KIND === 'mechanics' || (KIND === 'rigid3d' && W < 400), center, W, H,
    highlight: L => HL.some(h => h === L.label || sub12(h) === sub12(L.label)) });
  // Changing force visibility may change key height, but must not re-fit the camera.
  if (call.layoutChanged) { call.layoutChanged = false; if (!FORCE_KEY_CHANGE) requestAnimationFrame(refitStage); }
  FORCE_KEY_CHANGE = false;
}
function readout() {
  const rows = RIGID.readout();
  $('#readout').innerHTML = '<div class="rh">Computed by the app</div>' + rows.map(([k, v, u, cls]) => `<div class="r ${cls || ''}"><span>${esc(k)}</span><b>${esc(v)} ${esc(u || '')}</b></div>`).join('');
}

// ── inspecting ────────────────────────────────────────────────────────────────────────────────────────────────────
function clickStage(e) {
  if (KIND === 'rigid3d' && RIGID) { const hit = studio.pick(e.clientX, e.clientY, RIGID.pickables); SEL = hit ? { type: 'rigid' } : null; if (!SEL) $('#inspector').hidden = true; else inspectorRigid(true); return; }
  if (!world) return; const hit = studio.pick(e.clientX, e.clientY, world.pickables); const data = hit ? world.hit(hit.object) : null;
  if (!data) { clearSelection(); return; }
  if (data.type === 'body') { SEL = { type: 'body', id: data.id }; world.setFocus(data.id); world.select(null); }
  else if (data.type === 'string') { SEL = { type: 'string', id: data.id }; world.select(SEL); }
  else if (data.type === 'pivot') { SEL = { type: 'pivot', id: data.id }; world.select(null); }
  else if (data.type === 'spring') selectTeachingTarget(data);
}
// Selection changes the view, never the learner's hidden/revealed force intent.
function selectTeachingTarget(target) {
  setNativeForceBody(null); SEL = {type:target.type,id:target.id}; world.select(SEL);
  $('#inspector').hidden = true; setCamera('closeup');
}
function clearSelection() { SEL = null; if (world) { world.select(null); if (STEP_FOCUS) world.setFocus(STEP_FOCUS); else if (SCENE) world.setFocus(SCENE.focus); } $('#inspector').hidden = true; }
function inspectorRigid(force) {
  const el = $('#inspector'); if (!SEL || SEL.type !== 'rigid') { el.hidden = true; return; }
  const info = RIGID.inspector();
  const html = `<h4><i></i>${esc(info.title)}</h4>` + info.rows.map(([k, v, u]) => `<div class="r"><span>${esc(k)}</span><b>${esc(v)} ${esc(u)}</b></div>`).join('');
  if (el.dataset.v !== html || force) { el.innerHTML = html; el.dataset.v = html; }
  const p = call.screen(RIGID.focus(), studio.renderer.domElement.clientWidth, studio.renderer.domElement.clientHeight);
  el.hidden = false; el.style.left = clamp(p[0] + 40, 8, Math.max(8, studio.renderer.domElement.clientWidth - el.offsetWidth - 22)) + 'px'; el.style.top = clamp(p[1], el.offsetHeight / 2 + 8, studio.renderer.domElement.clientHeight - el.offsetHeight / 2 - 80) + 'px';
}
function inspectorMech(fr) {
  const el = $('#inspector'); if (!SEL || SEL.type === 'spring') { el.hidden = true; return; }
  let anchor = null, html = '';
  if (SEL.type === 'body') { const b = fr.bodies[SEL.id]; const spec = SCENE.bodies.find(x => x.id === SEL.id); if (!b) { el.hidden = true; return; } const v = Math.hypot(b.vx, b.vy); const ke = 0.5 * b.m * v * v, kr = 0.5 * b.I * b.w * b.w;
    const fs = fr.forces.filter(f => !world.incompleteReactionJoints?.has(f.joint) && f.body === SEL.id && Math.hypot(f.vec[0], f.vec[1]) > 1e-3).concat(world.stringForces(fr, SEL.id));
    html = `<h4><i></i>${esc(spec.label || SEL.id)}</h4><div class="r"><span>mass</span><b>${fmt(b.m)} kg</b></div><div class="r"><span>speed</span><b>${fmt(v)} m/s</b></div><div class="r"><span>ω</span><b>${fmt(b.w)} rad/s</b></div><div class="r"><span>I (CM)</span><b>${fmt(b.I, 4)} kg·m²</b></div><div class="r"><span>L = Iω</span><b>${fmt(b.I * b.w)} kg·m²/s</b></div><div class="r"><span>KE</span><b>${fmt(ke + kr)} J</b></div>` + (fs.length ? `<div class="f">${fs.map(f => `<div class="r"><span>${esc(f.label || f.kind)}</span><b>${fmt(Math.hypot(f.vec[0], f.vec[1]))} N</b></div>`).join('')}</div>` : '');
    anchor = new THREE.Vector3(b.cx + world.focusSize * 1.15, b.cy, 0); }
  else if (SEL.type === 'string') { const s = world.strings.find(x => x.id === SEL.id); if (!s || !s.segs.length) { el.hidden = true; return; } html = `<h4><i style="background:${hex(PALETTE.tension)}"></i>string ${esc(s.id)}</h4>` + s.segs.map(g => `<div class="r"><span>${esc(g.label)}</span><b>${g.tension != null ? fmt(g.tension) + ' N' : '—'}</b></div>`).join('') + `<div class="r" style="margin-top:4px;color:var(--ink3)"><span>the string pulls each end toward its middle</span></div>`; const g = s.segs[0]; anchor = g.a.clone().add(g.b).multiplyScalar(0.5); }
  else if (SEL.type === 'pivot') { const j = fr.joints[SEL.id]; if (!j) { el.hidden = true; return; } html = `<h4><i style="background:${hex(PALETTE.tension)}"></i>pivot ${esc(SEL.id)}</h4><div class="r"><span>reaction force</span><b>${fmt(Math.hypot(j.force[0], j.force[1]))} N</b></div><div class="r"><span>direction</span><b>${fmt(Math.atan2(j.force[1], j.force[0]) * 180 / Math.PI, 1)}°</b></div>`; if (world.incompleteReactionJoints?.has(SEL.id)) html = '<h4>Axle reaction unavailable</h4><p style="max-width:230px">This constraint model omits the string load on the support.</p>'; anchor = new THREE.Vector3(j.anchorA[0], j.anchorA[1], 0); }
  if (el.dataset.v !== html) { el.innerHTML = html; el.dataset.v = html; }
  const p = call.screen(anchor, studio.renderer.domElement.clientWidth, studio.renderer.domElement.clientHeight); el.hidden = false; const width = studio.renderer.domElement.clientWidth, height = studio.renderer.domElement.clientHeight; el.style.left = clamp(p[0], 8, Math.max(8, width - el.offsetWidth - 22)) + 'px'; el.style.top = clamp(p[1], el.offsetHeight / 2 + 8, Math.max(el.offsetHeight / 2 + 8, height - el.offsetHeight / 2 - 80)) + 'px';
}
function energy(fr) {
  if (!OV.energy) return; const rows = []; let tot = 1e-9;
  for (const b of SCENE.bodies) { if (b.type === 'static' || b.shape === 'edge') continue; const s = fr.bodies[b.id]; if (!s) continue; const v = Math.hypot(s.vx, s.vy); const ke = 0.5 * s.m * v * v, kr = 0.5 * s.I * s.w * s.w, pe = s.m * (SCENE.gravity ?? 9.8) * (s.cy - (world.bounds.floorY || 0)); rows.push([b.label || b.id, ke, kr, pe]); tot = Math.max(tot, ke + kr + Math.max(0, pe)); }
  $('#energy').innerHTML = '<div style="font-weight:600;margin-bottom:4px">Body energies</div>' + (SCENE.joints.some(j => j.type === 'spring') ? '<p class="cnote">Spring potential energy is not included.</p>' : '') + rows.map(([n, ke, kr, pe]) => `<div class="bar"><span>${esc(n)} · trans</span><i style="width:${(100 * ke / tot).toFixed(1)}%;background:${hex(PALETTE.body)}"></i><b>${fmt(ke, 2)} J</b></div><div class="bar"><span>rot</span><i style="width:${(100 * kr / tot).toFixed(1)}%;background:${hex(PALETTE.omega)}"></i><b>${fmt(kr, 2)} J</b></div>${SCENE.gravity ? `<div class="bar"><span>potential</span><i style="width:${(100 * Math.max(0, pe) / tot).toFixed(1)}%;background:${hex(PALETTE.weight)}"></i><b>${fmt(pe, 2)} J</b></div>` : ''}`).join('');
}
function formula() {
  const f = lesson && lesson.formula; const el = document.querySelector(`#csteps .step[data-i="${STEP}"] .formula`); if (!el) return;
  if (!f) { el.hidden = true; return; } el.hidden = false;
  const html = `$${esc(f.symbol)} = \\int_{${f.x0.toFixed(2)}}^{${f.x1.toFixed(2)}} ${esc(f.integrand).replace(/\*/g, '\\,').replace(/lambda/g, '\\lambda(x)').replace(/\^2/g, '^{2}')}\\,dx$ &nbsp;→ so far <b>${fmt(f.acc)} ${esc(f.units)}</b> at $x = ${f.x.toFixed(2)}$ m${f.done ? ' · done' : ''}`;
  if (el.dataset.v !== html) { el.innerHTML = html; el.dataset.v = html; math(el); }
}

// ── mechanics checks, saving, what-if ─────────────────────────────────────────────────────────────────────────────
function measure(c) {
  if (c.at != null && (!Number.isFinite(c.at) || c.at < 0 || c.at > SIM.duration)) return NaN;
  const fr = c.at == null ? SIM.frames[SIM.frames.length - 1] : E.frameAt(SIM, c.at);
  if (c.quantity === 'joint_force') { if (world?.incompleteReactionJoints?.has(c.joint)) return NaN; const j = fr.joints[c.joint]; return j ? Math.hypot(j.force[0], j.force[1]) : NaN; }
  const b = fr.bodies[c.body]; if (!b) return NaN;
  switch (c.quantity) {
    case 'speed': return Math.hypot(b.vx, b.vy); case 'omega': return b.w; case 'vx': return b.vx; case 'vy': return b.vy; case 'x': return b.cx; case 'y': return b.cy;
    case 'angle_deg': return b.a * 180 / Math.PI; case 'mass': return b.m; case 'inertia': return b.I;
    case 'ke': return 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + 0.5 * b.I * b.w * b.w;
    case 'ax': case 'ay': { const i = SIM.frames.indexOf(fr); const k = Math.max(1, Math.round(0.0125 / SIM.dt)); const a = SIM.frames[clamp(i - k, 0, SIM.frames.length - 1)].bodies[c.body], z = SIM.frames[clamp(i + k, 0, SIM.frames.length - 1)].bodies[c.body]; const dtt = (clamp(i + k, 0, SIM.frames.length - 1) - clamp(i - k, 0, SIM.frames.length - 1)) * SIM.dt; return dtt > 0 ? ((c.quantity === 'ax' ? z.vx - a.vx : z.vy - a.vy) / dtt) : NaN; }
    case 'normal': case 'friction': return fr.forces.filter(x => x.body === c.body && x.kind === c.quantity).reduce((s, x) => s + Math.hypot(x.vec[0], x.vec[1]), 0);
  }
  return NaN;
}
function runChecks() { return (SCENE.checks || []).map(c => checkResult(c, measure(c))); }
async function saveProblem() {
  const scene = { ...(TUTOR || SCENE) }; delete scene._ctx; delete scene._checks;
  if (!scene || !scene.title) return;
  try { const r = await api('/api/problems', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: scene.title, source: 'Kinema copy', text: coach.ctx.text || '', image: coach.ctx.image || '', scene, meta: coach.ctx.meta || {} }) }); toast('Saved a copy'); CURRENT = r.id; }
  catch (e) { toast('Save failed: ' + e.message); }
}
async function whatIf() {
  if (KIND !== 'mechanics' || !SCENE) return;
  const shown = { ...SCENE }; for (const k of ['_ctx', '_checks', 'steps', 'givens', 'unknowns', 'notes', 'answer', 'checks']) delete shown[k];
  const edited = prompt('Edit the scene (JSON) — masses, radii, friction, angles — and press OK to re-run it:', JSON.stringify(shown)); if (edited == null) return;
  let obj; try { obj = JSON.parse(edited); } catch (e) { toast('Not valid JSON: ' + e.message, 5000); return; }
  const keep = { steps: [{ title: 'Explore the changed setup', body: 'These parameters differ from the original problem. The original answer and checks have been cleared.', at: 0, show: ['labels'], actions: [], highlight: [] }], givens: [], unknowns: [], notes: 'Exploratory changes; original answer and checks cleared.', answer: {}, checks: [] };
  try { const r = await api('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: { ...obj, ...keep } }) }); CURRENT = null; loadResult(r.scene, { ...(SCENE._ctx || {}), id: null, warnings: r.warnings }); toast(r.warnings.length ? 'Re-ran with repairs — see notes' : 'Re-ran'); }
  catch (e) { toast('Could not re-run: ' + (e.message || e), 5000); }
}
