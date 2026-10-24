import { controlIcon } from './icons.js';
import { LessonSplitter } from './lesson_splitter.js';
import { StepReferences } from './step_references.js';
import { progressBadge } from './learning_progress.js';
import { esc, mdlite, math } from './md.js';
import { kinemaMark } from './brand.js';
import { modelButton, updateModelContext } from './model_menu.js';
import { byline } from './model_identity.js';
import { closeScreenshotPicker, isShotPickerOpen } from './screenshot_picker.js';
import { VisualLibrary } from './visual_library.js';
import { StudyPath, recalled } from './study_path.js';
import { presentText, forget } from './reply_reveal.js';
import { LiveDictation, actionMode, captureScreen, screenSupported, ICON_MIC, ICON_SHOT, ICON_STOP, ICON_SEND } from './composer_tools.js';
import { tileHTML, paintProgress, upload, settleIn } from './attach_tiles.js';
import { TopicCompanion } from './topic_companion.js';
import { BookWorkspace } from './book_workspace.js';
import { StudyWorkspace, studyChrome } from './study_workspace.js';
import { mountLibraryGraphs } from './library_graphs.js';
import { ChatStudyPane } from './chat_study_pane.js';
import { Experiments } from './experiments/experiments.js';
/* Kinema 1.11 — the continuing tutor: one conversation per course, Panel's chat and composer, the course/session
   sidebar and the tutor's own visual. The visual is the app's native stage (app.js stageHost), shown in the same
   artifact pane homework uses; it opens when the tutor shows something new and stays closed once you close it.
   Server contract: docs/TEACHER-API.md (one thread per course; Finish ends a session, Continue starts the next).
   Drafts are kept in this browser and on the server; the visual reports what is really on screen. */

const KEY = 'kinema.teacher.';
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(KEY + k); else localStorage.setItem(KEY + k, JSON.stringify(v)); return true; } catch { return false; } },
};
const rid = () => (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');
const svg = (box, body) => `<svg viewBox="${box}" aria-hidden="true">${body}</svg>`;
const ICON = {
  // Panel's own composer glyphs (static/index.html IC and the attach button)
  send: svg('0 0 16 16', '<path d="M8 13V3.5M3.8 7.2 8 3l4.2 4.2"/>'),
  stop: svg('0 0 16 16', '<rect x="4" y="4" width="8" height="8" rx="1.3" fill="currentColor" stroke="none"/>'),
  attach: svg('0 0 20 20', '<path d="m7 11 5-5a2 2 0 0 1 3 3l-6 6a3.5 3.5 0 0 1-5-5l7-7a5 5 0 0 1 7 7l-7 7"/>'),
  side: svg('0 0 20 20', '<rect x="3" y="4" width="14" height="12" rx="2.5"/><path d="M8 4v12"/>'),
  down: svg('0 0 24 24', '<path d="M12 5v14m-6-6 6 6 6-6"/>'),
  copy: svg('0 0 16 16', '<rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M3.5 11V3.5A1.5 1.5 0 0 1 5 2h6"/>'),
  plus: svg('0 0 20 20', '<path d="M10 4.5v11M4.5 10h11"/>'),
  experiment: svg('0 0 20 20', '<path d="M7 2h6M8 2v5l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V2M6 12h8"/><circle cx="9" cy="14" r=".6"/>'),
  bolt: svg('0 0 20 20', '<path d="M11.5 2 4.5 11h5l-1 7 7-10h-5Z"/>'),
  route: svg('0 0 20 20', '<circle cx="5" cy="15" r="1.8"/><circle cx="15" cy="5" r="1.8"/><path d="M6.8 15H12a2.5 2.5 0 0 0 0-5H8a2.5 2.5 0 0 1 0-5h5"/>'),
  book: svg('0 0 20 20', '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5Z"/><path d="M4 16.5A1.5 1.5 0 0 0 5.5 18H16"/>'),
  gear: svg('0 0 20 20', '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>'),
  cube: svg('0 0 20 20', '<path d="m10 2.5 6.5 3.7v7.6L10 17.5l-6.5-3.7V6.2Z"/><path d="m3.5 6.2 6.5 3.7 6.5-3.7M10 9.9v7.6"/>'),
};
const MAX_FILES = 6, MAX_BYTES = 20e6;   // the server's limits (app/teacher_content.py)
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,.png,.jpg,.jpeg,.gif,.webp,.md,.txt,.pdf';
const KIND_LABEL = { rigid3d: '3D model', mechanics: 'Simulation', plot: 'Graph', circuit: 'Circuit', diagram: 'Diagram' };
/* Reading size: the chat, composer, lessons and cards (and, half as much, the figure's labels) scale together; the
   visual's own geometry and the rest of the page do not. Kept per browser; a new preference starts at Comfortable. */
const READ_KEY = 'kinema.read', READ_DEFAULT = 1.2;
export const READ = [[1, 'Standard'], [1.2, 'Comfortable'], [1.35, 'Large'], [1.5, 'Extra large']];
const readSize = () => { const v = Number(localStorage.getItem(READ_KEY)); return READ.some(([x]) => x === v) ? v : READ_DEFAULT; };
const applyRead = v => { document.documentElement.style.setProperty('--read', String(v)); for (const it of window.__stageLabels?.items?.values() || []) it.dirty = true; };
try { applyRead(readSize()); } catch { /* no storage: the default size */ }
const PHASE = { starting: 'Starting', connecting: 'Connecting', thinking: 'Thinking', writing: 'Writing' };
const OVERLAY = matchMedia('(max-width:900px)');   // the visual pane covers the chat (teacher.css)
const PAGE_TITLE = { experiments:'Experiments', 'sim-lab': 'Simulation lab', daily: 'Daily problem', library: 'Library', path: 'Chapters', settings: 'Settings' };
const day = ts => new Date(ts * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const inline = html => html.replace(/^<p>|<\/p>$/g, '');
/* model replies: Kinema's mdlite plus the common markdown it lacks — a rule line (---, ***, ___) becomes a real <hr> and
   a #-heading a bold line, so raw syntax never shows */
const HR = '\u0001hr\u0001';
const reply = src => mdlite(String(src || '').replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '\n\n\n' + HR + '\n\n\n').replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/gm, '**$1**').trim())
  .replace(new RegExp('<p>' + HR + '</p>', 'g'), '<hr>').split(HR).join('');

/* a scanned book page's extracted text: drop the file stamp and running head, rebuild paragraphs from the printed line breaks */
function tidySource(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n').map(l => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  if (/^MORIN:\s*[\u201c"]?CHAP\d+/i.test(lines[0] || '')) lines.shift();
  if (/^(\d+\.\d+ .{3,70} \d{1,3}|\d{1,3} [A-Z].{3,70})$/.test(lines[0] || '')) lines.shift();
  const out = []; let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const t = buf.join(' ').replace(/\s+/g, ' ');
    out.push(buf.length === 1 && t.length < 60 && !/[.,;:?!)]$/.test(t) ? `<h3>${esc(t)}</h3>` : `<p>${esc(t)}</p>`); buf = [];
  };
  for (const l of lines) { if (!l) { flush(); continue; } buf.push(l); if (l.length < 52) flush(); }
  flush();
  return out.join('');
}

export class Teacher {
  constructor(host, d) {
    this.host = host; this.d = d; this.stage = d.stage; this.artifact = d.artifact;
    this.thread = null; this.courses = []; this.threads = [];
    this.pendingFiles = []; this.busy = false; this.active = false; this.loadToken = 0;
    this.aboutOff = true;   // the lesson or card is attached only by its own Ask
    this.embedded = window.top !== window;
    this.narrow = matchMedia('(max-width:720px)');
    this.shell();
    this.companion = new TopicCompanion(this);
    this.workspace = new StudyWorkspace(this); this.refs=new StepReferences(this);
    this.studyPane = new ChatStudyPane(this);
    this.book = new BookWorkspace(this);
    this.narrow.addEventListener('change', () => this.syncSide());
    OVERLAY.addEventListener('change',()=>{if(this.thread?.mode==='simulation'){this.renderVisualCard();this.syncVisual();}});
    addEventListener('pagehide', () => { this.workspace?.remember();this.book?.rememberVisual();this.saveDraft(); this.saveScroll(); this.rememberTime(); this.saveStudy(); });
  }

  // ── layout ────────────────────────────────────────────────────────────────────────────────────────────────────
  shell() {
    this.host.innerHTML = `
      <aside class="tv-side" id="tv-side" aria-label="Kinema">
        <div class="tv-side-top"><div class="tv-brand"><span class="kinema-mark">${kinemaMark}</span>Kinema</div><button type="button" class="tv-icon" data-act="side" aria-label="Hide sidebar" title="Hide sidebar">${ICON.side}</button></div>
        <nav class="tv-nav" id="tv-nav" aria-label="Kinema">
          <button type="button" class="tv-row" data-act="new-chat" id="tv-new">${ICON.plus}<span>New chat</span></button>
          <button type="button" class="tv-row" data-act="daily" hidden>${ICON.bolt}<span>Daily problem</span></button>
          <button type="button" class="tv-row" data-act="path">${ICON.route}<span>Chapters</span></button>
          <button type="button" class="tv-row" data-act="library">${ICON.book}<span>Library</span></button>
          <button type="button" class="tv-row" data-act="sim-lab">${ICON.cube}<span>Simulation lab</span></button>
          <button type="button" class="tv-row" data-act="experiments">${ICON.experiment}<span>Experiments</span></button>
        </nav>
        <div class="tv-chat-heading"><span>Chats</span></div><label class="tv-chat-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" id="tv-search" placeholder="Search chats" aria-label="Search chats"></label>
        <nav class="tv-threads" id="tv-threads" aria-label="Chats"></nav>
      </aside>
      <div class="tv-scrim" data-act="side" hidden></div>
      <div class="tv-main" id="tv-main">
        <div class="tv-head">
          <button type="button" class="tv-icon tv-reveal" data-act="side" aria-label="Show sidebar" title="Show sidebar">${ICON.side}</button>
          <span id="tv-book-return" hidden></span>
          <span class="tv-crumb" id="tv-crumb">Tutor</span>
          <span class="tv-grow"></span>
          <span class="tv-state" id="tv-state" role="status"></span>
          <span class="tv-readwrap"><button type="button" class="tv-icon tv-read" id="tv-read" data-act="read" aria-haspopup="menu" aria-expanded="false" aria-controls="tv-readpop" aria-label="Reading size" title="Reading size"><span aria-hidden="true">Aa</span></button>
            <div class="tv-readpop" id="tv-readpop" role="menu" aria-label="Reading size" hidden><div class="tv-readhd" aria-hidden="true">Reading size</div>${READ.map(([v, l]) => `<button type="button" role="menuitemradio" data-act="read-set" data-v="${v}"><span>${l}</span><small>${Math.round(v * 100)}%</small></button>`).join('')}<button type="button" role="menuitem" class="tv-readreset" data-act="read-reset">Reset</button></div></span>
          <button type="button" class="tv-finish" id="tv-ask" data-act="ask" hidden>Ask</button>
          <button type="button" class="tv-finish" id="tv-tochat" data-act="to-chat" hidden>Chat</button>
          <button type="button" class="tv-finish" id="tv-lesson" data-act="lesson" hidden>Back to lesson</button>
        </div>
        <div class="tv-scroll" id="tv-scroll"><div class="tv-col" id="tv-stream"></div></div>
        <div class="tv-pages" id="tv-page" hidden><div class="tv-gallery" id="tv-gallery" hidden></div><section class="pg pg-path" data-page="path" id="tv-pathpage" hidden></section></div>
        <div class="tv-study" id="tv-study" hidden><div class="tv-sp"></div></div>
        <div class="composer tv-composer">
          <button type="button" class="tv-latest" id="tv-latest" aria-label="Jump to latest" title="Jump to latest" hidden>${ICON.down}</button>
          <div class="tv-compose-stack">
          <div class="combox" id="tv-combox">
            <div class="tv-about" id="tv-about" hidden></div>
            <div class="attachrow at-row" id="tv-attach"></div>
            <textarea rows="1" id="tv-input" aria-label="Message the tutor" placeholder="Ask, or tell the tutor what you want to learn…" disabled></textarea>
            <div class="comrow">
              <button type="button" class="pill iconly" data-act="attach" aria-label="Attach files" title="Attach a problem screenshot, PDF or notes. Snap a photo of your work and I'll point to the line that went wrong">${ICON.attach}</button>
              <input type="file" id="tv-file" multiple accept="${ACCEPT}" hidden>
              <button type="button" class="pill iconly tv-tool tool-secondary" id="tv-mic" aria-pressed="false" hidden>${ICON_MIC}</button>${screenSupported() ? `<button type="button" class="pill iconly tv-tool" id="tv-shot" data-act="shot" aria-label="Recent screenshots" title="Recent screenshots">${ICON_SHOT}</button>` : ''}
              <span class="grow"></span>
              ${modelButton('chat', true, true)}
              <span class="pn-comrow-sep" aria-hidden="true"></span>
              <button type="button" class="send act-btn" id="tv-send" aria-label="Dictate" title="Dictate" data-action="dictate">${ICON_MIC}</button>
            </div>
            <div class="dict-note" id="tv-dnote" role="status" aria-live="polite"></div>
            <div class="capnote" id="tv-note" role="alert" hidden></div>
          </div>
          </div>
        </div>
      </div>
      <div class="tv-visual" id="tv-visual"></div>
      <dialog class="kinema-dialog tv-dialog" id="tv-dialog"></dialog>
      <div class="tv-cm" id="tv-cm" role="menu" hidden></div><div class="tv-toast" id="tv-toast" role="status" aria-live="polite" hidden></div>`;
    const $ = s => this.host.querySelector(s);
    this.el = { side: $('#tv-side'), scrim: $('.tv-scrim'), threads: $('#tv-threads'), crumb: $('#tv-crumb'), state: $('#tv-state'),
      scroll: $('#tv-scroll'), stream: $('#tv-stream'), latest: $('#tv-latest'), input: $('#tv-input'), file: $('#tv-file'),
      attach: $('#tv-attach'), send: $('#tv-send'), note: $('#tv-note'), dialog: $('#tv-dialog'), main: $('#tv-main'), page: $('#tv-page'), gallery: $('#tv-gallery'),
      study: $('#tv-study'), sp: $('#tv-study .tv-sp'), ask: $('#tv-ask'), fresh: $('#tv-new'), read: $('#tv-read'), readpop: $('#tv-readpop'), nav: $('#tv-nav'), tochat: $('#tv-tochat'), lesson: $('#tv-lesson'), about: $('#tv-about'), cm: $('#tv-cm'), toast: $('#tv-toast'), pathpage: $('#tv-pathpage'), composer: $('.tv-composer') };
    this.labSplitter=new LessonSplitter(this.host,$('#tv-visual'),{key:'kinema.simulationPaneRatio.v1',variable:'--sl-width',label:'Resize simulation pane',className:'sl-divider',breakpoint:900,defaultRatio:.4,enabled:()=>this.active&&!this.page&&!this.browsing&&this.thread?.mode==='simulation'&&this.artifact.opened&&!this.artifact.expanded&&!this.artifact.inline});
    this.experiments=new Experiments(this);
    this.host.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && this.host.contains(b)) this.act(b.dataset.act, b, e); });
    this.el.send.addEventListener('click', () => this.primary());
    $('#tv-search').addEventListener('input', e => {this.chatSearch=e.target.value;this.renderThreads();});
    const input = this.el.input;
    this.mic = new LiveDictation({ api: this.d.api, url: this.d.url, say: t => this.dnote(t) });
    this.mic.bind({ box: input, button: $('#tv-mic'), identity: () => `${this.thread?.id || ''}|${this.courseId || ''}|${this.active ? 1 : 0}`, say: t => this.dnote(t), onState: () => this.syncSend() });
    this.el.readpop.addEventListener('keydown', e => {
      const items = [...this.el.readpop.querySelectorAll('button')], i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.readMenu(false, true); }   // the menu, not the visual behind it
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); }
      else if (e.key === 'Tab') this.readMenu(false);
    });
    document.addEventListener('pointerdown', e => { if (!this.el.readpop.hidden && !e.target.closest?.('.tv-readwrap')) this.readMenu(false); }, true);
    this.syncRead();
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (this.payload()) this.sendMessage(); } });
    input.addEventListener('input', () => { this.fit(); this.syncSend(); clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => this.saveDraft(), 300); });
    input.addEventListener('paste', e => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); this.addFiles(files); } });
    this.el.file.addEventListener('change', () => { this.addFiles([...this.el.file.files]); this.el.file.value = ''; });
    this.el.main.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); this.el.main.classList.add('tv-drop'); } });
    this.el.main.addEventListener('dragleave', e => { if (!this.el.main.contains(e.relatedTarget)) this.el.main.classList.remove('tv-drop'); });
    this.el.main.addEventListener('drop', e => { this.el.main.classList.remove('tv-drop'); if (e.dataTransfer?.files?.length) { e.preventDefault(); e.stopPropagation(); this.intake([...e.dataTransfer.files]); } });
    // pinned: the student is following the latest message. Only their own scrolling unpins it (a smooth scroll we
    // started, or content growing under KaTeX, images or a narrower chat, never does); while pinned it stays at the end.
    this.pinned = true;
    const intent = () => {
      this.scrollEpoch = (this.scrollEpoch || 0) + 1;
      this.autoUntil = 0;
      this.pinned = false;
      this.reading = this.readingAt();
    };
    this.el.scroll.addEventListener('wheel', e => { if (!e.ctrlKey && e.deltaY) intent(); }, {passive:true});
    this.el.scroll.addEventListener('touchmove', intent, {passive:true});
    this.el.scroll.addEventListener('pointerdown', e => { if (e.clientX >= this.el.scroll.getBoundingClientRect().right - 18) intent(); }, {passive:true});
    this.el.scroll.addEventListener('keydown', e => { if (!e.target.closest('input,textarea,button') && ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)) intent(); });
    this.el.scroll.addEventListener('scroll', () => {
      if (performance.now() > (this.autoUntil || 0)) { this.pinned = this.nearBottom(); this.reading = this.pinned ? null : this.readingAt(); }
      this.syncLatest(); clearTimeout(this.scrollTimer); this.scrollTimer = setTimeout(() => this.saveScroll(), 250);
    }, { passive: true });
    // not following: keep the message being read in place when the chat reflows (visual opens, math renders)
    const resize = new ResizeObserver(() => {
      if (!this.active) return;
      if (this.pinned) this.toBottom(false);
      else if (this.reading) this.holdReading();
    });
    resize.observe(this.el.stream); resize.observe(this.el.scroll);
    new ResizeObserver(() => this.queueInputFit()).observe(input);   // widening releases old wrapped lines on the next frame
    this.el.latest.addEventListener('click', () => this.toBottom(true));
    this.el.threads.addEventListener('contextmenu', e => { const row = e.target.closest('.tv-thread'); if (!row) return; e.preventDefault(); this.openMenu(row.dataset.id, row.querySelector('.tv-more'), { x: e.clientX, y: e.clientY }); });
    setInterval(() => this.pollNotify(), 6000);
    this.sideOpen = store.get('side', !this.embedded);
    // An open visual that would squeeze the chat below a readable width folds the sidebar away (not saved);
    // the sidebar button still opens it for this visual, and it returns when the visual closes.
    let visual = false;
    const relayout = () => { const v = (this.host.classList.contains('visual-open') || this.host.classList.contains('topic-open')) && !this.host.classList.contains('visual-expanded'); if (v !== visual) { visual = v; if (!v) this.sideOverride = false; } this.syncSide(); };
    new MutationObserver(relayout).observe(this.host, { attributes: true, attributeFilter: ['class'] });
    new ResizeObserver(relayout).observe(this.host);
    this.syncSide();
  }
  squeezed() {
    if ((!this.host.classList.contains('visual-open') && !this.host.classList.contains('topic-open')) || this.host.classList.contains('visual-expanded')) return false;
    const w = this.host.clientWidth;
    const dock = this.host.classList.contains('topic-open') ? Math.min(840, Math.max(430, Number(this.companion?.pref().width) || (w - 200) * .48)) : Math.min(540, Math.max(380, w * .38));
    return w - 200 - dock < (this.host.classList.contains('topic-open') ? 620 : 560);
  }
  syncSide() {
    const narrow = this.narrow.matches, open = narrow ? !!this.drawer : this.sideOpen && (this.sideOverride || !this.squeezed());
    if (this.host.classList.contains('tv-side-open') === open && this.el.side.inert === !open && this.el.scrim.hidden === !(narrow && open)) return;
    this.host.classList.toggle('tv-side-open', open);
    this.el.scrim.hidden = !(narrow && open);
    this.el.side.inert = !open;
    this.host.querySelectorAll('.tv-reveal').forEach(b => b.setAttribute('aria-expanded', String(open)));
    this.companion?.layout();
  }
  toggleSide() {
    if (this.narrow.matches) this.drawer = !this.drawer;
    else if (this.squeezed()) { const show = !(this.sideOpen && this.sideOverride); this.sideOverride = show; if (show && !this.sideOpen) { this.sideOpen = true; store.set('side', true); } }
    else { this.sideOpen = !this.sideOpen; store.set('side', this.sideOpen); }
    this.syncSide();
    if (this.narrow.matches && this.drawer) this.el.nav.querySelector('button')?.focus({ preventScroll: true });
  }
  closeDrawer() { if (this.drawer) { this.drawer = false; this.syncSide(); } }

  act(name, button, e) {
    if (name === 'side') return this.toggleSide();
    if (name === 'row-menu') { e?.stopPropagation(); return this.openMenu(button.dataset.id, button); }
    if (name === 'cm') return this.menuAction(button.dataset.op, button.dataset.id);
    if (name === 'pp-open') { this.savePathScroll(); this.ppOpen = button.dataset.n; return this.renderPathPage(); }
    if (name === 'pp-ask') { let ctx = null; try { ctx = JSON.parse(button.dataset.ctx || 'null'); } catch { /* no scope */ } this.savePathScroll(); this.closeDrawer(); return this.launchAbout(button.dataset.text, ctx, button.dataset.lessonTab); }
    if (name === 'pp-back') { this.savePathScroll(); this.ppOpen = null; return this.renderPathPage(); }
    if (name === 'pp-retry') return this.renderPathPage();
    if (name === 'mt-pick') return button.closest('[data-pane]')?.querySelector('[data-mt-file]')?.click();
    if (name === 'mt-reload') return this.loadMaterials(button.closest('[data-pane]'));
    if (name === 'mt-retry' || name === 'mt-dismiss') { const box = button.closest('[data-pane]'), f = (this.mtQueue || []).find(x => x.key === button.dataset.key); if (!f) return;
      if (name === 'mt-retry') return this.uploadMaterial(box, f.file, f);
      this.mtQueue = this.mtQueue.filter(x => x !== f); return this.paintMaterialQueue(box); }
    if (name === 'gr-chat') { this.leaveViews(); return this.openThread(button.dataset.thread); }
    if (name === 'gr-preview') return this.previewGraph(button.dataset.id, button);
    if (name === 'toast-open') { this.el.toast.hidden = true; this.closeDrawer(); this.leaveViews(); return this.openThread(button.dataset.id); }
    if (name === 'new-chat') { this.closeDrawer(); this.leaveViews(); return this.newChat(); }
    if (name === 'lesson-start') {
      if (!this.thread?.lesson_entry || this.busy || this.thread.pending || this.el.input.value.trim()) return;
      this.el.input.value = this.thread.lesson_entry.starter || 'Start with a simple example.';
      this.fit(); this.syncSend(); this.saveDraft(); this.el.input.focus(); return;
    }
    if (name === 'chat') { this.workspace.cancel(); this.workspace.beginVisit(); this.closeDrawer(); this.leaveViews(); if (button.dataset.id === this.thread?.id) { this.syncVisual(true); return this.toBottom(true); } return this.openThread(button.dataset.id); }
    if (name === 'read') return this.readMenu(this.el.readpop.hidden);
    if (name === 'read-set' || name === 'read-reset') return this.setRead(name === 'read-reset' ? READ_DEFAULT : Number(button.dataset.v));
    if (name === 'shot') return this.shot();
    if (name === 'source') { e?.preventDefault(); return this.showSource(button.dataset.url, button.dataset.title); }
    if (name === 'attach') return this.el.file.click();
    if (name === 'copy') return this.copyMessage(button);
    if (name === 'retry-upload') { const f = this.pendingFiles.find(x => x.key === button.dataset.key); if (f?.file) { f.error = null; this.renderFiles(); this.syncSend(); this.uploadOne(f); } return; }
    if (name === 'unattach') { this.pendingFiles.filter(f => f.key === button.dataset.key).forEach(f => f.abort?.abort()); this.pendingFiles = this.pendingFiles.filter(f => f.key !== button.dataset.key); this.renderFiles(); this.saveDraft(); return this.syncSend(); }
    if (name === 'retry') return this.retry();
    if (name === 'visual') { e?.preventDefault(); if(['simulation','experiment'].includes(this.thread?.mode)&&!this.artifact.sceneHost)return this.syncVisual(true); return this.artifact.open(!this.artifact.opened); }
    if (name === 'visual-at') {
      this.visualAnchor = { thread: this.thread.id, artifact: this.thread.artifact?.id, mid: button.dataset.mid };
      this.renderMessages(false); this.artifact.open(true, false);
      this.el.stream.querySelector('.tv-inline-visual')?.scrollIntoView({block:'center', behavior:'smooth'}); return;
    }
    if (name === 'path') { this.savePathScroll(); this.ppOpen=null; this.closeDrawer(); return this.openPage('path'); }
    if (name === 'ask') return this.askHere();
    if (name === 'to-chat') return this.showChat();
    if (name === 'lesson') return this.showLesson();
    if (name === 'about-clear') { this.attachStudy(false); this.renderAbout(); return this.el.input.focus(); }
    if (name === 'sim-lab') { this.closeDrawer(); return this.openSimulation(); }
    if (name === 'experiments') { this.closeDrawer(); return this.openPage('experiments'); }
    if (name === 'daily' || name === 'library') { this.closeDrawer(); if (name === 'daily') this.saveDraft(); return this.openPage(name); }
    if (name === 'dialog-close') return this.el.dialog.close();
  }
  /* back to the conversation: closes whichever page or lesson is open in its place */
  leaveViews() { this.navigationEpoch = (this.navigationEpoch || 0) + 1; closeScreenshotPicker(); this.closePage(false); if (this.studyShown) this.showChat(false); this.setCrumb(); this.renderStatus(); }
  setCrumb() {
    const t = this.thread;
    const back = this.host.querySelector('#tv-book-return');
    const problem = !this.page && !this.studyShown && t?.book_problem && !this.workspace?.manages(t);
    back.hidden = !problem;
    if (problem) back.innerHTML = this.book?.returnHTML(problem) || '';
    else back.innerHTML = '';
    if(!this.page&&!this.studyShown&&t?.mode==='experiment'){back.hidden=false;back.innerHTML='<button type="button" class="exp-back" data-act="experiments" aria-label="Back to Experiments">←<span> Experiments</span></button>';}
    this.el.crumb.textContent = this.page ? (this.page==='path'?'':PAGE_TITLE[this.page]) : this.studyShown ? 'Chapters' : this.workspace?.manages(t) ? 'Chat' : t ? (t.label || t.title || 'Chat') : 'Chat';
    math(this.el.crumb);
  }
  /* Daily problem, Library and Settings take the place of the chat inside the same shell */
  /* Daily needs a matching book; without one it has no nav entry at all. Checked at boot and whenever a page opens, so an imported book shows it. */
  async refreshDaily() {
    const row = this.host.querySelector('.tv-nav [data-act="daily"]'); if (!row) return;
    try { row.hidden = !(await this.d.api(this.d.url('/api/daily/peek')))?.id; } catch { row.hidden = true; }
  }
  openPage(name) {
    this.refreshDaily();
    if (this.page === name) { if (name === 'path') this.renderPathPage(); return; }
    this.navigationEpoch = (this.navigationEpoch || 0) + 1; closeScreenshotPicker();
    this.workspace?.history.set(null); this.workspace?.remember(); this.saveDraft();
    this.mic?.cancel(true);
    this.book?.leave();
    this.closePage(false);
    if (this.studyShown) this.showChat(false);
    this.page = name; this.host.dataset.page = name; this.host.classList.add('tv-paged'); this.el.page.hidden = false;
    this.rememberTime(); this.quietly(() => { this.artifact.open(false, false); this.artifact.mountInline(null); });
    this.el.page.querySelectorAll('[data-page]').forEach(p => { p.hidden = p.dataset.page !== name; });
    this.setCrumb(); this.renderStatus(); this.readMenu(false);
    if (name === 'path') this.renderPathPage(true);
    if (name === 'experiments') this.experiments.paintGallery();
    this.d.onPage?.(name, true);
  }
  closePage(restore = true) {
    if (!this.page) return;
    this.savePathScroll();
    const was = this.page; this.page = null; delete this.host.dataset.page; this.host.classList.remove('tv-paged'); this.el.page.hidden = true;
    if (this.browsing) this.closeGallery(restore);
    this.d.onPage?.(was, false);
    if (restore) { this.setCrumb(); this.renderStatus(); this.syncVisual(true); }
  }

  // ── entering / leaving the view ───────────────────────────────────────────────────────────────────────────────
  async enter() {
    this.active = true; this.syncSide();
    const oldStudy = store.get('study');
    if (oldStudy?.mode === 'cards') {
      // Archive navigation before fresh-thread handling can consume it; leave all card stores unchanged.
      if (!store.get('legacy-cards-study')) store.set('legacy-cards-study', oldStudy);
      store.set('study', { mode: null, shown: false }); this.attachStudy(false);
    }
    if (!this.loaded) { this.loaded = this.boot(); }
    await this.loaded;
    if (this.thread) { await this.syncVisual(true); this.follow(); }
    if (!this.studyRestored) {
      this.studyRestored = true; const st = store.get('study');
      if (st?.mode === 'path' && st.shown !== false) store.set('study', { ...st, shown: false });
    }
    this.watchPlayback();
  }
  leave() {
    if (!this.active) return;
    this.mic?.cancel(true);
    this.rememberTime(); this.saveDraft(); this.saveScroll();
    this.book?.leave();this.workspace?.history.set(null);this.workspace?.visual.leave();
    this.active = false; clearTimeout(this.pollTimer); clearInterval(this.watchTimer); this.closeDrawer();
    if (this.browsing) this.closeGallery(false);
  }
  async boot() {
    let b;
    try { b = await this.d.api(this.d.url('/api/teacher/bootstrap')); }
    catch (e) { this.loaded = null; this.renderUnavailable(e); return; }
    this.courses = b.courses || []; this.threads = b.threads || [];
    this.refreshDaily();
    const saved = store.get('course');
    const current = this.threads.find(t => t.id === b.current_thread);
    this.courseId = current?.course_id || (this.courses.some(c => c.id === saved) ? saved : this.courses[0]?.id) || null;
    this.renderCourses();
    const id = current?.course_id === this.courseId ? current.id : this.latestThread(this.courseId)?.id;
    const reading = this.workspace.restore();
    if (reading?.scope) await this.workspace.open(reading.scope, reading.origin, {resume:true});
    else if (id) await this.openThread(id, true); else await this.startCourse();
    /* a fresh chat (New chat, or one the server started) opens as an empty tutor the first time this browser sees it: the
       previous lesson or cards place is not reopened on top. Once seen, a reload resumes whatever is open again. */
    const t = this.thread;
    if (t && (t.fresh_start || current?.fresh_start) && t.id === current?.id && !store.get('seen.' + t.id)) { store.set('seen.' + t.id, 1); const st = store.get('study'); store.set('study', st?.deck ? { mode: null, shown: false, deck: st.deck } : null); }   // only the obsolete navigation marker is retained; no card records are touched
  }
  /* New chat: the server opens a new, neutral conversation for this course; the old one and its history stay saved */
  /* Opening a lesson saves its scope and prepared references atomically. Teaching
     starts only with the student's explicit question or starter click. */
  async launchAbout(text, ctx = null, tab = null) {
    this.launchScope = null;
    if (ctx) return this.workspace.open({ study_context: ctx },null,{tab});
    return this.newChat();
  }
  /* the chapter scope of a launch belongs to its own message in its own thread and nothing else */
  takeScope(text) {
    const l = this.launchScope;
    return l && l.thread === this.thread?.id && l.text === text ? l.ctx : null;
  }
  async askAbout(text) {
    if (!await this.newChat()) return false;
    if (!text || !this.el.input) return false;
    this.el.input.value = text; this.fit?.(); this.syncSend?.(); this.saveDraft?.(); this.el.input.focus({ preventScroll: true });
    this.el.input.setSelectionRange(text.length, text.length);
    return true;
  }
  async openSimulation() {
    const ok=await this.newChat({mode:'simulation',resume:true});
    if(ok){const b=await this.d.api(this.d.url('/api/teacher/bootstrap'));this.threads=b.threads;this.renderThreads();}
    return ok;
  }
  async newChat(scope = {}) {
    this.workspace.cancel();
    this.mic?.cancel(true);
    this.leaveViews();
    this.launchScope = null;
    if (!this.courseId && this.loaded) await this.loaded;
    const originCourse = this.courseId, course = scope.course_id || originCourse; if (!course || this.creating || this.busy) return false;
    const epoch = this.navigationEpoch, token = ++this.loadToken;
    this.threadLoading = null;
    this.creating = true; this.renderStatus(); this.note('');
    this.saveDraft(); this.saveScroll(); this.rememberTime();
    const key = 'fresh.' + course + '.' + JSON.stringify(scope), request_id = store.get(key) || 'fresh-' + rid(); store.set(key, request_id);
    try {
      const t = await this.post('/api/teacher/threads', { course_id: course, request_id, fresh: true, ...scope });
      store.set(key, null); store.set('seen.' + t.id, 1);
      this.upsertSummary(t);
      if (this.courseId !== originCourse || this.navigationEpoch !== epoch || token !== this.loadToken) return false;
      this.courseId = t.course_id; store.set('course', t.course_id);
      this.setThread(t, { restore: true }); this.attachStudy(false); this.renderAbout(); this.el.input.focus({ preventScroll: true });
      return true;
    } catch (e) { if (this.navigationEpoch === epoch && token === this.loadToken) this.note('Could not start a new chat: ' + e.message); return false; }
    finally { this.creating = false; this.renderStatus(); }
  }
  /* A course without a thread starts one at once: the server writes a fixed opening (no model call) and, for 2301,
     the paused rod view. The request id is kept per course so a reload never makes a second opening. */
  async startCourse() {
    this.setThread({ id: 'reading:new:' + this.courseId, reading: true, course_id: this.courseId, messages: [], revision: 0, title: 'New chat' }, { restore: true });
  }
  renderUnavailable(e) {
    this.thread = null; this.setCrumb();
    this.artifact.parkInline();
    this.el.stream.innerHTML = `<div class="tv-empty"><h2>The tutor isn't available</h2><p>${esc(e?.message || 'The server did not answer.')}</p><p><button type="button" class="tv-btn" data-act="retry-boot">Try again</button></p></div>`;
    this.el.stream.querySelector('[data-act=retry-boot]').onclick = () => { this.loaded = this.courses.length ? this.startCourse() : this.boot(); };
  }

  // ── chats ──────────────────────────────────────────────────────────────────────────────────────────────────────
  latestThread(course) { return this.threads.filter(t => t.course_id === course).sort((a, b) => (b.opened_ts || b.updated_ts || 0) - (a.opened_ts || a.updated_ts || 0))[0]; }
  renderCourses() { this.renderThreads(); }
  async switchCourse(id) {
    if (id === this.courseId) return;
    this.saveDraft(); this.saveScroll(); this.rememberTime();
    this.courseId = id; store.set('course', id); this.thread = null; this.renderThreads(); this.renderStatus();
    const t = this.latestThread(id);
    if (t) await this.openThread(t.id); else await this.startCourse();
  }
  /* every chat of the course, newest first; a row opens it. Names come from the first question. */
  renderThreads() {
    const cur = this.thread?.id;
    const query=String(this.chatSearch||'').trim().toLocaleLowerCase();
    const rows = this.threads.filter(t => (!query || String(t.label||t.title||'').toLocaleLowerCase().includes(query)) && t.course_id === this.courseId && (!t.fresh_start || t.lesson_entry || t.pending || t.id === this.thread?.id)).sort((a, b) => (!!b.pinned - !!a.pinned) || (b.opened_ts || b.updated_ts || 0) - (a.opened_ts || a.updated_ts || 0));
    const dots = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor" stroke="none"/></svg>`;
    let group='';
    this.el.threads.innerHTML = rows.map(r => {
      const next=r.pinned?'Pinned':new Date((r.opened_ts||r.updated_ts||0)*1000).toDateString()===new Date().toDateString()?'Today':'Earlier';
      const label=group===next?'':`<div class="tv-chat-group">${next}</div>`;group=next;
      const here = r.id === cur && !this.page && !this.studyShown, name = r.label || r.title;
      return `${label}<div class="tv-row tv-thread${here ? ' on' : ''}${r.pinned ? ' pinned' : ''}" data-id="${esc(r.id)}"><button type="button" class="tv-tname" data-act="chat" data-id="${esc(r.id)}"${here ? ' aria-current="page"' : ''} title="${esc(name)}">${r.pinned ? '<b class="tv-pin" aria-label="Pinned"></b>' : ''}<span>${esc(name)}</span>${r.pending ? '<i class="tv-busy" aria-label="Replying"></i>' : ''}${r.notify ? '<i class="tv-bell" aria-label="Notify is on"></i>' : ''}</button><button type="button" class="tv-more" data-act="row-menu" data-id="${esc(r.id)}" aria-haspopup="menu" aria-label="Chat options for ${esc(name)}" title="Chat options">${dots}</button></div>`;
    }).join('') || `<p class="tv-none">${query?'No matching chats':'No chats yet'}</p>`;
  }
  /* Local opening copy, never a saved tutor turn. The first message replaces it. */
  greetingHTML() {
    const t = this.thread;
    if (!t) return '';
    const row = t.topic_companion ? this.workspace.selected(t.topic_companion) : null;
    const topic = String(row?.title || t.lesson_entry?.title || '').trim();
    const line = (tag, key, text) => `<${tag}${key ? ` data-i18n="${key}"` : ''} dir="auto">${esc(text)}</${tag}>`;
    const body = t.mode==='experiment'
      ? line('h1','',t.experiment?.title||'Experiment')+line('p','','Change the setup, watch what happens, or ask about a step.')
      : t.mode==='simulation'
      ? line('h1','','What would you like to simulate?')
      : t.book_problem
      ? line('h1', 'greet_problem_title', 'Where would you like to start?') + line('p', 'greet_problem_sub', 'Ask about the problem, or share your first step.')
      : topic && (t.lesson_entry || t.topic_companion)
        ? line('h1', '', topic) + line('p', 'greet_lesson_sub', 'Ask about a step, or work through an example.')
        : line('h1', 'greet_new_title', 'What would you like to understand?') + line('p', 'greet_new_sub', 'Paste a problem or a photo, or ask about any idea.');
    return `<div class="tv-greeting">${body}</div>`;
  }
  renderEmpty(starting = false) {
    clearTimeout(this.pollTimer);
    const course = this.courses.find(c => c.id === this.courseId);
    this.setCrumb();
    this.artifact.parkInline();
    this.el.stream.innerHTML = starting ? '' : this.greetingHTML();
    this.el.state.textContent = ''; this.el.input.disabled = true;
    this.renderVisualCard(); this.quietly(() => this.artifact.open(false, false));
    this.restoreDraft(); this.renderThreads(); this.syncSend();
  }

  // ── a thread ──────────────────────────────────────────────────────────────────────────────────────────────────
  draftKey() { return 'draft.' + (this.thread?.id || 'new:' + this.courseId); }
  async openThread(id, first = false, {reading = false} = {}) {
    this.mic?.cancel(true);
    if (!reading) this.workspace.beginVisit();
    if (!first) { this.saveDraft(); this.saveScroll(); }
    const token = ++this.loadToken, epoch = this.navigationEpoch;
    this.threadLoading = id; this.renderStatus();
    let t; try { t = await this.d.api(this.d.url('/api/teacher/threads/' + encodeURIComponent(id))); }
    catch (e) { if (token === this.loadToken) { this.threadLoading = null; this.renderStatus(); } if (token === this.loadToken && epoch === this.navigationEpoch) { if(reading)throw e;if (e.status === 404) { this.threads = this.threads.filter(x => x.id !== id); return this.startCourse(); } this.renderUnavailable(e); } return; }
    if (token === this.loadToken) this.threadLoading = null;
    if (token !== this.loadToken || epoch !== this.navigationEpoch) { this.renderStatus(); return; }
    this.courseId = t.course_id; store.set('course', t.course_id);
    this.setThread(t, { restore: true });
  }
  setThread(t, { restore = false } = {}) {
    const was = this.thread, changed = was?.id !== t.id;
    this.thread = t; this.upsertSummary(t);
    this.workspace.accept(t, changed);
    this.host.classList.toggle('sw-active', this.workspace.manages(t));
    this.host.classList.remove('tv-is-empty');
    this.host.classList.toggle('tv-book-thread', !!t.book_problem);
    this.host.classList.toggle('tv-simulation-thread', t.mode==='simulation');
    this.host.classList.toggle('tv-experiment-thread', t.mode==='experiment');
    if(changed&&['simulation','experiment'].includes(was?.mode))this.quietly(()=>this.artifact.open(false,false));
    if (changed) { this.partial = ''; this.phase = ''; this.pendingModel = null; this.restoreDraft(); this.aboutOff = store.get('ask') !== t.id; }
    const sig = x => x && JSON.stringify([x.revision, x.messages?.length, x.pending, x.status, x.error, x.artifact?.status, x.artifact?.revision, x.book_problem?.source_revision]);
    if (restore || changed || sig(t) !== sig(was)) this.renderMessages(restore || changed);
    this.setCrumb(); this.renderStatus(); this.renderThreads(); this.syncSend();
    if (was?.id === t.id && was.pending && !t.pending && t.notify) this.notifyDone(t.id, t.label || t.title);
    if (was?.id === t.id && was.pending && !t.pending && this.studyMode === 'path') this.path?.refresh();   // a tutor reply may mark the practice as helped
    if (was?.id === t.id && was.pending && !t.pending && t.mode!=='experiment') { const r = (t.messages || []).findLast(m => m.role === 'assistant' && m.kind !== 'session'); if (r?.text) window.KinemaRefresher?.consider({ title: '', text: r.text, source: 'tutor' }); }   // a weak prerequisite in a study reply may slide in a refresher card
    this.syncVisual();
    this.path?.setExploring(this.guideExplored());
    this.follow();
  }
  upsertSummary(t) {
    if (t.reading) return;
    const row = { mode:t.mode, id: t.id, course_id: t.course_id, title: t.title, label: t.label, status: t.status, session: t.session, lesson_entry: t.lesson_entry, fresh_start: t.fresh_start, pinned: !!t.pinned, notify: !!t.notify, pending: !!t.pending, opened_ts: Date.now() / 1000, updated_ts: t.messages?.at(-1)?.created_ts };
    const i = this.threads.findIndex(x => x.id === t.id);
    if (i < 0) this.threads.push(row); else this.threads[i] = { ...this.threads[i], ...row };
  }
  renderStatus() {
    const t = this.thread, away = !!(this.page || this.studyShown);
    // The incoming conversation restores its own draft. Do not accept typing that this restore would overwrite.
    this.el.input.disabled = !t || !!this.creating || !!this.threadLoading;
    this.el.composer.inert = !!this.threadLoading;
    this.el.ask.hidden = this.el.tochat.hidden = !this.studyShown || this.page;
    if (!this.path?.context()) this.el.ask.hidden = true;
    this.el.fresh.disabled = !!this.creating || this.busy;
    this.syncSection();
    this.el.lesson.hidden = this.studyMode !== 'path' || !this.path?.context() || this.studyShown || !!this.page;
    this.el.lesson.innerHTML = controlIcon('left')+' '+(this.narrow.matches ? 'Lesson' : 'Back to lesson');
    const art = t?.artifact;
    this.el.state.textContent = away || t?.pending ? '' : art?.status === 'preparing' ? 'Preparing a new view…' : '';
    this.companion?.render();
    this.book?.syncScene();
    this.syncLatest(); this.workspace?.sync();this.studyPane?.sync();
    const waiting=!!t&&!away&&!this.threadLoading&&!t.pending&&!t.error&&!t.messages?.some(m=>m.role==='user')&&!this.host.classList.contains('lr-has-visual')&&!this.host.classList.contains('visual-inline');
    this.host.classList.toggle('tv-awaiting-input',waiting);
  }
  // ── reading size ──────────────────────────────────────────────────────────────────────────────────────────────
  readMenu(open, refocus = false) {
    this.el.readpop.hidden = !open; this.el.read.setAttribute('aria-expanded', String(open));
    if (open) (this.el.readpop.querySelector('[aria-checked="true"]') || this.el.readpop.querySelector('button')).focus();
    else if (refocus) this.el.read.focus();
  }
  setRead(v) {
    try { if (v === READ_DEFAULT) localStorage.removeItem(READ_KEY); else localStorage.setItem(READ_KEY, String(v)); } catch { /* this visit only */ }
    const keep = this.pinned ? null : this.readingAt();
    applyRead(v); this.syncRead();
    requestAnimationFrame(() => { if (keep) this.restoreScroll(keep); else this.toBottom(false); });   // the same place, just larger
  }
  syncRead() {
    const v = readSize();
    this.host.querySelectorAll('[data-act="read-set"]').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.v) === v)));
    this.el.read.title = `Reading size: ${Math.round(v * 100)}%`;
  }
  syncSection() {
    const on = this.page || (this.studyShown ? 'path' : this.thread?.mode==='experiment'?'experiments':this.thread?.mode==='simulation'?'sim-lab':'chat');
    this.renderThreads();
    this.el.nav.querySelectorAll('[data-act]').forEach(b => { const sel = b.dataset.act === on; b.classList.toggle('on', sel); if (sel) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  }
  renderMessages(restore) {
    const t = this.thread, keep = !restore && this.pinned, prior = this.el.scroll.scrollTop, epoch = this.scrollEpoch;
    const msgs = t.messages || [], art = !this.workspace.manages(t) && (t.mode==='simulation'||msgs.some(m => m.role === 'user') || msgs.some(m => m.role === 'assistant')) ? t.artifact : null;
    let anchor = -1;   // the visual card sits after the message that showed it, else after the latest reply
    if (art) { anchor = msgs.findLastIndex(m => m.visual_action?.artifact_id === art.id); if (anchor < 0) anchor = msgs.findLastIndex(m => m.role === 'assistant' && m.kind !== 'session'); }
    if (this.visualAnchor?.thread === t.id && this.visualAnchor.artifact === art?.id) { const selected = msgs.findIndex(m => m.id === this.visualAnchor.mid); if (selected >= 0) anchor = selected; }
    const parts = msgs.map((m, i) => this.messageHTML(m, msgs[i - 1]) + (i === anchor ? '<div class="tv-card-slot"></div>' : art && anchor - i > 1 && m.visual_action?.artifact_id === art.id ? `<button type="button" class="tv-inline-reopen tv-visual-link" data-act="visual-at" data-mid="${esc(m.id)}">Open current ${this.visualType(art)} <span aria-hidden="true">↗</span></button>` : ''));
    if (art && anchor < 0) parts.push('<div class="tv-card-slot"></div>');
    if (t.pending) parts.push(`<div class="amsg tv-pending" aria-live="polite"><div class="ahead">${byline(t.pending_choice || {}, true)}</div><div class="mdb">${this.pendingBody()}</div></div>`);
    if (t.error && !t.pending) parts.push(`<div class="tv-error" role="alert"><p>${esc(t.error)}</p>${this.canRetry() ? '<button type="button" class="tv-btn" data-act="retry">Try again</button>' : ''}</div>`);
    if (!msgs.length && !t.pending && !t.error) parts.push(this.greetingHTML());
    if(t.mode==='experiment')parts.push('<button type="button" class="exp-reopen" data-act="visual" data-visual>Open experiment ↗</button>');
    this.artifact.parkInline(); this.book?.parkScene();
    this.el.stream.innerHTML = (this.libraryFolders?.returnHTML(t) || '') + this.workspace.html(t) + parts.join('');
    this.experiments.updateReopen();
    this.book.syncScene();
    this.settleNew(t, msgs, restore);
    this.renderVisualCard();
    math(this.el.stream);
    this.paintPending(true); this.revealFinal(msgs, restore);
    updateModelContext(this.el.main, { kind: 'teacher', messages: msgs });
    requestAnimationFrame(() => {
      if (epoch !== this.scrollEpoch) return;
      if (restore) { this.restoreScroll(); if (!(t.book_problem && !msgs.length)) this.pinned = this.nearBottom(); }
      else if (keep) this.toBottom(false);
      else if (this.reading) this.restoreScroll(this.reading);
      else this.el.scroll.scrollTop = prior;
      this.syncLatest();
    });
  }
  /* a newly delivered bubble (or the pending row appearing) settles in once; first load of a thread never animates */
  settleNew(t, msgs, restore) {
    const first = this.seenThread !== t.id || restore; if (this.seenThread !== t.id) { this.seenThread = t.id; this.seenMids = new Set(); this.seenPending = false; }
    for (const m of msgs) {
      if (!this.seenMids.has(m.id) && !first) settleIn(this.el.stream.querySelector(`[data-mid="${CSS.escape(String(m.id))}"]`));
      this.seenMids.add(m.id);
    }
    const p = this.el.stream.querySelector('.tv-pending');
    if (p && !this.seenPending && !first) settleIn(p);
    this.seenPending = !!p;
  }
  paintPending(force = false) {
    const mdb = this.el.stream.querySelector('.tv-pending .mdb'); if (!mdb) return;
    if (!this.partial) { forget(mdb); mdb.innerHTML = this.pendingBody(); return; }
    presentText(mdb, this.partial, t => { const keep = this.pinned; mdb.innerHTML = reply(t); math(mdb); if (keep) this.toBottom(false); }, { force });
  }
  /* a reply that arrives whole (or its last batch) is revealed the same way, continuing from what was already shown */
  revealFinal(msgs, restore) {
    const want = this.revealNext; this.revealNext = null;
    if (!want || restore || want.thread !== this.thread?.id) return;
    const last = msgs.findLast(m => m.role === 'assistant' && m.kind !== 'session');
    if (!last || !last.text) return;
    // Saved legacy details stay part of the same complete reply during reveal.
    const text = [last.text, typeof last.details === 'string' ? last.details.trim() : ''].filter(Boolean).join('\n\n');
    const node = this.el.stream.querySelector(`.amsg[data-mid="${CSS.escape(String(last.id))}"] > .mdb`); if (!node) return;
    const paint = t => { const keep = this.pinned; node.innerHTML = reply(t); math(node); if (keep) this.toBottom(false); };
    const seed = want.seed && text.startsWith(want.seed) ? want.seed : '';
    presentText(node, seed, paint, { force: true }); presentText(node, text, paint, { animate: true });
  }
  pendingBody() { return this.partial ? reply(this.partial) : `<p class="tv-thinking">${esc(this.phase || 'Thinking')}</p>`; }
  messageHTML(m, prev) {
    if (m.kind === 'session') return '';
    if (m.kind === 'legacy_status') return `<p class="tv-legacy-status">${esc(m.text)}</p>`;
    // A completed build is the artifact card, not an extra tutor turn repeating its specification.
    // Legacy saved text is only hidden in presentation; its original record remains intact.
    if (m.kind === 'visual' && (m.delivery_status === 'ready' || /^The new view is ready:/i.test(m.text || ''))) return `<div class="tv-visual-anchor" data-mid="${esc(m.id)}"></div>`;
    if (m.role === 'user') {
      const files = (m.attachment_ids || []).map(id => this.attachmentChip(id)).join('');
      return `<div class="u-msg" data-mid="${esc(m.id)}"><div class="ubody">${m.visible_step?.reference_label?`<div class="tv-sent-reference">${esc(m.visible_step.reference_label)}</div>`:''}${files ? `<div class="udocs">${files}</div>` : ''}${m.text ? `<p>${esc(m.text)}</p>${this.copyButton(m)}` : ''}</div></div>`;
    }
    // Textbook page citations stay private grounding: no Morin reading chips. Quizzes, notes and uploads keep theirs.
    const src = (m.sources || []).filter(s => s && s.title && s.id !== 'morin' && !/\/api\/teacher\/sources\/morin(?:[?/]|$)/.test(String(s.url || '')));
    let text = m.text || '', more = typeof m.details === 'string' ? m.details.trim() : '', plan = m.reply_kind === 'plan';
    if (more) { text = `${text.trimEnd()}${String.fromCharCode(10, 10)}${more}`; more = ''; }
    const details = m.experiment_chip&&!this.experiments.rejected.has(m.id) ? `<span class="exp-action-chip">${esc(m.experiment_chip)}</span>` : '';
    return `<div class="amsg" data-mid="${esc(m.id)}"><div class="ahead">${byline(m)}</div><div class="mdb">${reply(text)}</div>${details}${m.visual_note ? `<p class="tv-vnote">${esc(m.visual_note)}</p>` : ''}${src.length ? `<div class="srcrow">${src.map(s => this.sourceChip(s.url, s.title + (s.page != null ? ' · p. ' + s.page : ''))).join('')}</div>` : ''}${text ? this.copyButton(m) : ''}</div>`;
  }
  copyButton(m) { return `<button type="button" class="tv-copy" data-act="copy" data-id="${esc(m.id)}" aria-label="Copy message" title="Copy message">${ICON.copy}</button>`; }
  async copyMessage(button) {
    const m = this.thread?.messages.find(m => m.id === button.dataset.id);
    if (!m) return;
    try {
      await navigator.clipboard.writeText([m.text, m.details].filter(Boolean).join('\n\n'));
      button.setAttribute('aria-label', 'Copied'); button.title = 'Copied'; this.d.toast('Copied');
    } catch { this.d.toast('Could not copy. Select the message text to copy it.'); }
  }
  /* book and notes pages open in a reader here; attached files open as themselves */
  sourceChip(url, label) {
    if (!url) return `<span class="fchip">${esc(label)}</span>`;
    url = String(url).replace(/^\/api\/apps\/kinema\/view(?=\/)/, '');
    if (url.startsWith('/api/teacher/sources/')) return `<button type="button" class="fchip" data-act="source" data-url="${esc(url)}" data-title="${esc(label)}">${esc(label)}</button>`;
    return `<a class="fchip" href="${esc(this.d.url(url))}" target="_blank" rel="noopener">${esc(label)}</a>`;
  }
  attachmentChip(id) {
    const a = this.known?.get(id);
    return this.sourceChip(a?.url || '/api/teacher/attachments/' + encodeURIComponent(id), a?.name || 'Attachment');
  }
  // ── sending, stopping, finishing ──────────────────────────────────────────────────────────────────────────────
  payload() { return !!(this.el.input.value.trim() || this.pendingFiles.some(f => f.id)); }
  syncSend() {
    const pending = !!this.thread?.pending, uploading = this.pendingFiles.some(f => !f.id && !f.error), failed = this.pendingFiles.some(f => f.error);
    const m = this.mic, hasDraft = this.payload() || (uploading && !!this.pendingFiles.length);
    const mode = pending ? 'stop' : actionMode({ pending, hasDraft, dictating: !!m?.active, finishing: !!m?.finishing });
    const b = this.el.send;
    b.innerHTML = mode === 'dictate' ? ICON_MIC : mode === 'dictating' ? ICON_STOP : mode === 'transcribing' ? '<span class="act-dots"><i></i><i></i><i></i></span>' : mode === 'stop' ? ICON.stop : ICON_SEND;
    const label = { dictate: m && !m.ready ? m.reason : 'Dictate', dictating: 'Stop dictation and review', transcribing: 'Finishing your words…', stop: 'Stop',
      send: uploading ? 'Waiting for uploads' : failed ? 'Remove the failed upload to send' : pending ? 'Wait for the reply to finish' : 'Send' }[mode];
    b.setAttribute('aria-label', label); b.title = label; b.dataset.action = mode;
    b.classList.toggle('rec', mode === 'dictating');
    b.disabled = mode === 'transcribing' || (this.busy && mode !== 'dictating') || (mode === 'send' && (pending || uploading || failed || !this.thread));
    b.setAttribute('aria-disabled', String(b.disabled || (mode === 'dictate' && !!m && !m.ready)));
    const sec = this.host.querySelector('#tv-mic');
    if (sec) sec.hidden = !m || !m.ready || (!pending && (!hasDraft || m.active));
  }
  async primary() {
    const mode = this.el.send.dataset.action, m = this.mic;
    if (mode === 'dictate') return m.toggle();
    if (mode === 'dictating') return m.finish();
    if (mode === 'stop') return this.stop();
    if (mode === 'send') return this.sendMessage();
  }
  dnote(text) { const n = this.host.querySelector('#tv-dnote'); if (n) n.textContent = text || ''; }
  queueInputFit() {
    const input = this.el.input, width = input.getBoundingClientRect().width;
    if (Math.abs(width - (this.inputFitWidth || 0)) <= .5) return;
    this.inputFitWidth = width;
    if (this.inputFitFrame != null) return;
    // Height writes inside ResizeObserver can trigger another delivery before paint.
    this.inputFitFrame = requestAnimationFrame(() => {
      this.inputFitFrame = null;
      if (input.isConnected && this.el.input === input) this.fit();
    });
  }
  fit() { const i = this.el.input; i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 220) + 'px'; }
  note(text) { this.el.note.hidden = !text; this.el.note.textContent = text || ''; }
  async post(path, body) { return this.d.api(this.d.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 60000); }
  actPath() { return `/api/teacher/threads/${encodeURIComponent(this.thread.id)}/act`; }
  /* 409: the server sends its current view; show it and keep whatever is in the composer */
  /* 409: the thread moved on (a poll, a visual report or another window). Take the fresh copy; the caller retries once. */
  conflict(e, text = 'This conversation changed in another window; it has been refreshed.') {
    if (e.status !== 409 || !e.body?.thread) return false;
    this.setThread(e.body.thread); this.note(text);
    return true;
  }
  canRetry() {
    const t = this.thread;
    // Match teacher.act('retry'): no running reply and the durable last message is the user's.
    // A failed/stopped/interrupted reply need not have any particular error text.
    return !!t && !t.reading && !t.pending && t.messages?.filter(m=>m.kind!=='legacy_status').at(-1)?.role === 'user';
  }
  applies(action) {
    const t = this.thread; if (!t) return false;
    return action === 'cancel' ? !!t.pending : action === 'retry' ? this.canRetry() && !t.pending : true;
  }
  async sendMessage(again = true) {
    if (this.mic?.active && !await this.mic.finish()) return;
    if (this.busy || this.creating || this.threadLoading || this.el.send.disabled || this.el.send.dataset.action === 'stop' || !this.thread) return;
    const text = this.el.input.value.trim(), files = this.pendingFiles.filter(f => f.id);
    if (!text && !files.length) return;
    if (window.KinemaAccount && !window.KinemaAccount.signedIn) { window.KinemaAccount.promptSignIn(); return; }
    const readingContext = this.stepReference || this.workspace.visibleContext();
    const readingVisual = this.visualState(), readingBookVisual = this.book?.visualState();
    const readingReference = this.thread.topic_companion ? (this.stepReference?.section_id || this.workspace.selected()?.id) : undefined;
    const readingDraftKey = this.thread.reading ? this.draftKey() : null;
    if (!await this.workspace.ensureConversation()) return;
    // A delayed pre-send draft save must not restore the just-sent question.
    clearTimeout(this.serverDraftTimer);
    const sending = this.thread, epoch = this.navigationEpoch, draftKey = this.draftKey();
    const stillHere = () => this.thread?.id === sending.id && this.navigationEpoch === epoch;
    this.busy = true; this.note(''); this.syncSend();
    this.el.stream.querySelector('.tv-starters')?.remove();   // the opening starters go with the first send
    const draft = store.get(draftKey) || {};
    const request_id = draft.request_id || rid();   // a resend after a network failure reuses the id: never a duplicate turn
    store.set(draftKey, { ...draft, text: this.el.input.value, files: files.map(({ key, id, name, kind, url }) => ({ key, id, name, kind, url })), request_id });
    try {
      for (const f of files) this.remember(f);
      const study_context = this.takeScope(text) || this.messageContext() || undefined;   // omitted keeps the thread's chapter scope; only an explicit null would clear it
      const lesson_reference_id = readingReference || (this.thread.topic_companion ? this.workspace.selected(this.thread.topic_companion)?.id : undefined);
      const book_solution_message_id = this.companion.solutionMessageId?.();
      const t = await this.post(this.actPath(), { action: 'message', revision: this.thread.revision, request_id, text, attachment_ids: files.map(f => f.id), visual_state: readingVisual, experiment_state:this.experiments.snapshot(), book_visual_state: readingBookVisual, lesson_reference_id, book_solution_message_id, study_context, ...this.screenContext(), ...(readingContext ? { visible_step: readingContext } : {}) });
      store.set(draftKey, null); if(stillHere()){this.stepReference=null;this.refs?.render();} this.draftFiles?.delete(draftKey); this.upsertSummary(t); this.busy = false;
      if(readingDraftKey&&readingDraftKey!==draftKey){store.set(readingDraftKey,null);this.draftFiles?.delete(readingDraftKey);}
      if (!stillHere()) {
        // A late accepted send updates its own chat without leaving the destination page or clearing its draft.
        if (this.thread?.id === sending.id) { this.el.input.value = ''; this.pendingFiles = []; this.renderFiles(); this.fit(); this.setThread(t); }
        this.renderThreads(); this.renderStatus(); this.syncSend(); return;
      }
      this.el.input.value = ''; this.pendingFiles = []; this.renderFiles(); this.fit();
      this.launchScope = null; this.partial = ''; this.phase = ''; this.pendingModel = null; this.attachStudy(false);   // it went with this message
      this.busy = false; if (this.studyShown) this.showChat(false); this.setThread(t); this.renderAbout(); this.toBottom(true);
    } catch (e) {
      this.busy = false;
      if (e.status === 409) store.set(draftKey, { ...(store.get(draftKey) || {}), request_id: null });
      if (!stillHere()) { this.renderStatus(); this.syncSend(); return; }
      if (e.status === 409 && e.body?.thread && again && !e.body.thread.pending) { this.setThread(e.body.thread); return this.sendMessage(false); }
      if (!this.conflict(e, 'This conversation changed in another window; it has been refreshed. Your message is still here.')) this.note('Not sent: ' + e.message + (/your message/i.test(e.message) ? '' : ' Your message is still here.'));
      this.syncSend(); this.renderStatus();
    }
  }
  // Explicit book help is a normal durable turn, independent of the unsent composer.
  async sendHelp(text, again = true) {
    if (this.busy || this.creating || this.threadLoading || this.thread?.pending || !this.thread?.book_problem || this.mic?.active) return false;
    if (window.KinemaAccount && !window.KinemaAccount.signedIn) { window.KinemaAccount.promptSignIn(); return false; }
    const local = this.thread, epoch = this.navigationEpoch;
    const visible_step = this.workspace.visibleContext();
    this.busy = true; this.saveDraft(); this.syncSend();
    if (!await this.workspace.ensureConversation()) { this.busy = false; this.syncSend(); return false; }
    const sending = this.thread;
    if (epoch !== this.navigationEpoch || sending.book_problem?.id !== local.book_problem.id) { this.busy = false; this.syncSend(); return false; }
    const stillHere = () => this.thread?.id === sending.id && this.navigationEpoch === epoch;
    const key = sending.id + ':' + text;
    if (this.helpRequest?.key !== key) this.helpRequest = { key, request_id: rid() };
    this.busy = true; this.note(''); this.syncSend(); this.renderStatus();
    try {
      const t = await this.post(this.actPath(), { action: 'message', revision: sending.revision,
        request_id: this.helpRequest.request_id, text, attachment_ids: [], visible_step,
        visual_state: this.visualState(), book_visual_state: this.book?.visualState(), ...this.screenContext() });
      this.helpRequest = null; this.upsertSummary(t);
      if (stillHere()) {
        this.partial = ''; this.phase = ''; this.pendingModel = null;
        this.setThread(t); this.renderAbout(); this.toBottom(true);
      }
      this.renderThreads(); return true;
    } catch (e) {
      if (!stillHere()) return false;
      if (e.status === 409) this.helpRequest = null;
      if (e.status === 409 && e.body?.thread && again && !e.body.thread.pending) {
        this.setThread(e.body.thread); this.busy = false; return this.sendHelp(text, false);
      }
      if (!this.conflict(e)) this.note('Help not sent: ' + e.message + ' Try the help button again.');
      return false;
    } finally { this.busy = false; this.syncSend(); this.renderStatus(); }
  }
  async simpleAct(action, failText, extra = {}) {
    if (action === 'retry' && window.KinemaAccount && !window.KinemaAccount.signedIn) { window.KinemaAccount.promptSignIn(); return false; }
    const t = this.thread; if (!t || this.busy) return false;
    this.busy = true; this.syncSend(); this.renderStatus();
    try {
      for (let again = true; ; again = false) {
        try { this.setThread(await this.post(this.actPath(), { action, revision: this.thread.revision, request_id: rid(), ...extra })); return true; }
        catch (e) {
          if (e.status === 409 && e.body?.thread && again) { this.setThread(e.body.thread); if (this.applies(action)) continue; this.note(''); return false; }
          if (!this.conflict(e)) this.note(failText + ': ' + e.message); return false;
        }
      }
    } finally { this.busy = false; this.syncSend(); this.renderStatus(); }
  }
  startProblemSolution() { return this.problemSolution('start'); }
  nextProblemStep() { return this.problemSolution('next'); }
  problemSolution(action) { return this.workspace.reveal('step'); }
  async stop() { if (!this.thread?.pending) return false; return this.simpleAct('cancel', 'Could not stop the reply'); }
  async retry() { if (this.canRetry()) { this.partial = ''; this.phase = ''; await this.simpleAct('retry', 'Could not retry'); } else this.el.input.focus(); }

  // ── pending work: reply jobs, visual builds, recap wording ────────────────────────────────────────────────────
  follow() {
    clearTimeout(this.pollTimer);
    const t = this.thread; if (!t || !this.active) return;
    if (t.pending) this.pollTimer = setTimeout(() => this.pollJob(t.id, t.pending, 'pending'), 700);
    else if (t.artifact?.status === 'preparing') this.pollTimer = t.build_job ? setTimeout(() => this.pollJob(t.id, t.build_job, 'build_job'), 1500) : setTimeout(() => this.reread(t.id), 2500);
  }
  async pollJob(threadId, jobId, field) {
    // still the job this browser is following: a reply to an old job (after Stop, Retry or a newer message in the same
    // thread) must neither touch the pending reply nor schedule anything
    const live = () => this.active && this.thread?.id === threadId && this.thread[field] === jobId;
    if (!live()) return;
    let j;
    try { j = await this.d.api(this.d.url('/api/jobs/' + encodeURIComponent(jobId))); }
    catch (e) { if (!live()) return; if (e.status === 404) return this.reread(threadId); this.pollTimer = setTimeout(() => this.pollJob(threadId, jobId, field), 2500); return; }
    if (!live()) return;
    if (j.status === 'running') {
      if (field === 'pending') {
        const s = j.stream, at = this.streamAt;
        let partial = this.partial;
        if (s) {
          const newer = at?.job !== jobId || s.pass > at.pass || (s.pass === at.pass && s.seq > at.seq);
          if (newer) { this.streamAt = { job: jobId, pass: s.pass, seq: s.seq }; partial = s.answer || ''; }
          const kind = j.partial?.reply_kind, asked = (this.thread?.messages || []).findLast(x => x.role === 'user');
          if (newer && at?.job === jobId && s.pass === at.pass && partial.length < this.partial.length && this.partial.startsWith(partial)) partial = this.partial;
        } else partial = typeof j.partial?.answer === 'string' ? j.partial.answer : '';   // never the provider's raw text draft
        const phase = PHASE[j.phase] || (j.phase ? j.phase.charAt(0).toUpperCase() + j.phase.slice(1) : 'Thinking');
        const model = j.info?.model || null;
        if (partial !== this.partial || phase !== this.phase || model !== this.pendingModel) {
          this.partial = partial; this.phase = phase; this.pendingModel = model;
          const p = this.el.stream.querySelector('.tv-pending');
          if (p) { p.querySelector('.ahead').innerHTML = byline(j.info || {}, true); this.paintPending(false); }
        }
      }
      this.pollTimer = setTimeout(() => this.pollJob(threadId, jobId, field), field === 'pending' ? 700 : 1500); return;
    }
    if (field === 'pending') this.revealNext = { thread: threadId, seed: this.partial };
    this.reread(threadId);
  }
  /* reload the thread; a late response older than what this browser already shows is ignored */
  async reread(id) {
    try {
      const t = await this.d.api(this.d.url('/api/teacher/threads/' + encodeURIComponent(id)));
      if (this.thread?.id !== id || t.revision < this.thread.revision) return;
      if (t.revision > this.thread.revision || t.pending !== this.thread.pending) { this.partial = ''; this.phase = ''; this.pendingModel = null; }
      this.setThread(t);
    } catch { if (this.active && this.thread?.id === id) this.pollTimer = setTimeout(() => this.reread(id), 3000); }
  }

  // ── the visual ────────────────────────────────────────────────────────────────────────────────────────────────
  visualKey(art) { return art ? art.id + '@' + art.revision : null; }
  visualType(art) {
    const kind = art?.scene?.visualization?.kind;
    return kind === 'plot' ? 'graph' : ['diagram','circuit'].includes(kind) ? 'diagram' : 'simulation';
  }
  visualChrome(art) {
    const type = this.visualType(art), staticView = !!art && type === 'diagram';
    this.artifact.pane.classList.toggle('tv-static-visual', staticView);
    this.artifact.pane.querySelector('#study')?.classList.toggle('is-inline-static', staticView);
    this.artifact.pane.querySelector('[data-artifact-details]').hidden = !!art && type !== 'simulation';
  }
  /* the newest message that showed this artifact revision: its id, view and whether to open */
  showAction(art) {
    const m = (this.thread?.messages || []).findLast(x => x.visual_action?.type === 'show' && x.visual_action.artifact_id === art.id && x.visual_action.revision === art.revision);
    return m ? { mid: m.id, open: m.visual_action.open !== false } : null;
  }
  /* Load the native stage when the artifact changes and apply the tutor's view. A new show (a message this browser has
     not acted on) opens the pane unless the server says the student closed this same revision; otherwise the student's
     own open/closed choice and time are kept. */
  async syncVisual(reentered = false) {
    if(this.thread?.mode==='experiment')return this.experiments.sync(this.thread,reentered);
    if (this.workspace?.active()) {this.workspace.sync();return;}
    if(this.thread?.mode==='simulation'&&!this.page&&!this.previewing){this.renderVisualCard();return this.d.syncLab?.(this.thread,reentered);}
    if (this.previewing) return this.renderVisualCard();   // the library preview holds the stage until the gallery closes
    if (this.page && !this.browsing) { this.quietly(() => this.artifact.open(false, false)); this.renderVisualCard(); return; }
    const art = this.thread?.artifact, key = this.visualKey(art);
    this.visualChrome(art);
    if (!this.thread?.messages?.length) { this.quietly(() => this.artifact.open(false, false)); return; }
    if (!art || art.status !== 'ready' || !art.scene) { if (!art || art.status === 'error') this.quietly(() => this.artifact.open(false, false)); this.renderVisualCard(); return; }
    if (this.loadingKey === key) return;
    const seen = store.get('visual') || {}, same = seen.key === key, action = this.showAction(art);
    const fresh = action && action.mid !== seen.mid;
    const viewSig = JSON.stringify(art.view || {});
    let loaded = false;
    if (this.stage.owner() !== key) {
      this.loadingKey = key; this.visualError = null; this.renderVisualCard();
      const r = await this.stage.load(art.scene, key, { prepared: !!art.guide });
      this.loadingKey = null;
      if (this.visualKey(this.thread?.artifact) !== key || JSON.stringify(this.thread?.artifact?.view || {}) !== viewSig) return this.syncVisual();
      if (!r.ok) { this.visualError = r.error; this.quietly(() => this.artifact.open(false, false)); this.renderVisualCard(); this.reportVisual(); return; }
      this.quietly(() => {
        this.artifact.configure(r.kind || 'diagram', art.title);
        this.artifact.setStep({ kind: 'native', caption: art.caption || '', title: art.title || KIND_LABEL[r.kind] || 'Visual' });
      });
      loaded = true;
    }
    // Navigation can happen while stage.load awaits assets. A hidden modal must
    // never leave Daily or Study path inert; the saved open choice is restored on return.
    if (this.page && !this.browsing) { this.quietly(() => this.artifact.open(false, false)); this.renderVisualCard(); return; }
    const view = art.view || {}, seq = view.seq || 0, seek = !!view.seek && (!same || seen.seq !== seq);
    if (view.hidden) this.stage.pause?.();
    else if ((loaded || fresh || seen.view !== viewSig) && !(same && seen.hiddenSeq === seq && !loaded)) {
      // the teacher's play/pause always applies; its time only on a new seek command (else the student's moment stays)
      const time = seek ? view.time : loaded ? (same && seen.time != null ? seen.time : view.time) : undefined;
      // slider values only from the teacher's own latest edit, once (a later layer or camera command keeps the student's values)
      const edit = view.parameters && view.parameters_seq === seq && (loaded || !same || seen.pseq !== seq) ? view.parameters : undefined;
      const playing = this.stage.apply({ ...view, parameters: edit, time, playing: !!view.playing }).playing;
      this.reducedNote = !!view.playing && !playing && this.stage.reducedMotion();
    }
    // another browser has no local record: the server's last report (if the backend sends it) says the student closed it
    const sv = this.thread.student_view, closedThere = !same && sv?.artifact_id === art.id && sv?.revision === art.revision && (sv.view_seq || 0) === seq && !!sv.closed_by_user;
    let open = closedThere ? false : fresh ? action.open || (same && !!seen.open) : same ? !!seen.open : action ? action.open : true;
    const teacherHidden = !!view.hidden && !(same && seen.userOpenSeq === seq && seen.open);
    if (teacherHidden) open = false;
    else if (!same && sv?.open && sv?.artifact_id === art.id && sv?.revision === art.revision && sv?.view_seq === seq) open = true;
    if (!same && !fresh && this.studyShown && OVERLAY.matches) open = false;
    const closed = teacherHidden ? false : closedThere || (!open && (fresh ? !action.open : !!seen.closed));
    store.set('visual', { key, open, closed, hiddenSeq: view.hidden ? seq : same ? seen.hiddenSeq : null, userOpenSeq: same ? seen.userOpenSeq : null, mid: action?.mid || seen.mid || null, view: viewSig, seq, pseq: view.parameters_seq === seq ? seq : same ? seen.pseq ?? null : null, time: same && !seek ? seen.time ?? null : null });
    this.renderVisualCard();
    if (this.active && (loaded || fresh || reentered || this.artifact.opened !== open)) this.quietly(() => this.artifact.open(open, false));
    // Refit the chosen camera after the dock opens too. A named side/front view
    // is an orientation, not permission to keep the hidden pane's old aspect.
    if (loaded && open) requestAnimationFrame(() => { if (this.stage.owner() === key) this.stage.refit?.(); });
    this.renderVisualCard();
    this.reportVisual();
  }
  quietly(fn) { this.quiet = true; try { fn(); } finally { this.quiet = false; } }
  /* ProblemArtifact.onChange: remember the student's own open/close (and where the motion was) and tell the server */
  visualChanged(open) {
    this.labSplitter?.queue();
    this.experiments?.visualChanged(open);
    if(this.thread?.mode==='experiment')return;
    if(this.thread?.mode==='simulation'){this.markCard(open);return;}
    if (this.active && this.companion?.expanded) this.el.main.inert = true;
    if(this.workspace?.active())return;
    if (!this.active || !this.thread?.artifact || this.previewing) return;
    if(this.thread.mode==='simulation')return;
    this.markCard(open);
    if (this.quiet) return;
    const key = this.visualKey(this.thread.artifact);
    if (this.stage.owner() !== key) return;
    const seen = store.get('visual') || {};
    store.set('visual', { ...seen, key, open, closed: !open, userOpenSeq: open ? this.thread.artifact.view?.seq || 0 : null, time: +this.stage.state().t.toFixed(3) });
    this.reportVisual();
  }
  rememberTime() {
    const art = this.thread?.artifact, key = this.visualKey(art), seen = store.get('visual') || {};
    if (key && seen.key === key && this.stage.owner() === key) store.set('visual', { ...seen, time: +this.stage.state().t.toFixed(3) });
  }
  /* what the student actually sees, in the server's visual_state shape */
  visualState() {
    const art = this.thread?.artifact; if (!art || this.thread.mode==='simulation') return null;
    const shelfVisible=!this.studyPane?.active()||this.artifact.expanded||(!this.studyPane.el.hidden&&this.studyPane.state().tab==='visual');
    const rendered = shelfVisible && art.status === 'ready' && !this.visualError && this.stage.owner() === this.visualKey(art) && this.loadingKey !== this.visualKey(art);
    const s = this.stage.state(), seen = store.get('visual') || {};
    return { artifact_id: art.id, revision: art.revision, view_seq: rendered ? art.view?.seq || 0 : 0, rendered, open: rendered && !!this.artifact.opened, closed_by_user: seen.key === this.visualKey(art) && !!seen.closed,
      playing: rendered && !!s.playing, time: rendered ? +s.t.toFixed(3) : null, speed: rendered ? s.speed : null, camera: rendered ? s.camera : null,
      show: rendered ? s.show : [], reduced_motion: this.stage.reducedMotion(),
      reopened_by_user: rendered && !!this.artifact.opened && seen.userOpenSeq === (art.view?.seq || 0),
      ...(rendered && s.parameters ? { parameters: s.parameters, parameters_changed: !!s.parameters_changed } : {}) };
  }
  /* StudyView: the student moved a slider or reset them; the tutor must describe what is drawn now */
  paramsChanged() { if (this.active && this.thread?.artifact && this.stage.owner() === this.visualKey(this.thread.artifact)) { this.reportVisual(); this.path?.setExploring(this.guideExplored()); } }
  /* viewer report (no revision needed). Sent on render, open/close and play/pause; identical reports are skipped. A
     report can start the tutor's explanation of a freshly built view, so a changed revision is shown at once. */
  reportVisual() {
    if (window.KinemaAccount && !window.KinemaAccount.signedIn) return;
    clearTimeout(this.reportTimer);
    this.reportTimer = setTimeout(async () => {
      const t = this.thread, state = this.visualState(); if (!t || !state || this.previewing) return;
      const sig = JSON.stringify({ ...state, time: null });
      if (sig === this.reported) return;
      this.reported = sig;
      try { const v = await this.post(this.actPath(), { action: 'visual', request_id: rid(), visual_state: state }); if (this.thread?.id === v.id && v.revision !== this.thread.revision) this.setThread(v); }
      catch { this.reported = null; }
    }, 250);
  }
  watchPlayback() {
    clearInterval(this.watchTimer);
    this.watchTimer = setInterval(() => { const art = this.thread?.artifact; if (art && this.stage.owner() === this.visualKey(art) && this.stage.state().playing !== this.lastPlaying) { this.lastPlaying = this.stage.state().playing; this.reportVisual(); } }, 800);
  }
  markCard(open) {
    this.el.stream.querySelectorAll('.tv-visual-card[data-visual]').forEach(b => { b.setAttribute('aria-expanded', String(open)); const a = b.querySelector('.tv-vc-action'); if (a) a.textContent = open ? 'Showing' : 'Open'; });
    this.el.stream.querySelectorAll('.tv-inline-visual').forEach(s => s.hidden = !open || this.artifact.expanded);
    this.el.stream.querySelectorAll('.tv-card-slot .tv-inline-reopen').forEach(b => b.hidden = open);
  }
  renderVisualCard() {
    if(this.thread?.mode==='experiment'){this.experiments.updateReopen();return;}
    if(this.workspace?.active()) return;
    if(this.thread?.mode==='simulation'){
      if(this.page||this.browsing||this.previewing)return;
      const slot=this.el.stream.querySelector('.tv-card-slot');
      if(slot){if(!slot.querySelector('.tv-inline-visual'))slot.innerHTML='<div class="tv-inline-visual"></div><button class="tv-inline-reopen" data-act="visual" data-visual>Open simulation</button>';
      this.quietly(()=>this.artifact.mountInline(OVERLAY.matches?slot.querySelector('.tv-inline-visual'):null));this.markCard(this.artifact.opened);}
      return;
    }
    this.visualChrome(this.thread?.artifact);
    const slot = this.el.stream.querySelector('.tv-card-slot'); if (!slot) return;
    const art = this.thread?.artifact; if (!art) { slot.innerHTML = ''; return; }
    const key = this.visualKey(art), label = art.status === 'preparing' ? 'New view' : art.title || 'Visual';
    let state, ready = false;
    if (art.status === 'preparing') state = 'Preparing…';
    else if (art.status === 'error') state = 'Couldn’t be made: ' + (art.error || 'unknown error');
    else if (this.visualError) state = 'Couldn’t be drawn here: ' + this.visualError;
    else if (this.loadingKey === key || this.stage.owner() !== key) state = 'Loading…';
    else { ready = true; state = this.reducedNote ? 'Paused — your system asks for reduced motion' : art.caption || ''; }
    if(this.studyPane?.present(art,ready))return;
    if (ready && !this.browsing) {
      if (!slot.querySelector('.tv-inline-visual')) slot.innerHTML = `<div class="tv-inline-visual" aria-label="${esc(label)}"></div><button type="button" class="tv-inline-reopen" data-act="visual" data-visual>Open ${esc(label)} <span aria-hidden="true">↗</span></button>`;
      this.quietly(() => this.artifact.mountInline(slot.querySelector('.tv-inline-visual')));
      this.markCard(this.artifact.opened);
    } else {
      if (slot.contains(this.artifact.pane)) this.artifact.parkInline();
      slot.innerHTML = `<div class="tv-visual-card is-${art.status === 'error' || this.visualError ? 'error' : 'busy'}" role="status"><span class="tv-vc-icon">${ICON.cube}</span><span class="tv-vc-text"><b>${esc(label)}</b><small>${esc(state)}</small></span></div>`;
    }
  }

  // ── the visual library: browse in place of the chat, preview on the shared stage, study through the thread ─────
  openGallery() {
    if (this.studyShown) this.showChat(false);
    this.quietly(() => this.artifact.mountInline(null));
    if (!this.gallery) this.gallery = new VisualLibrary(this.el.gallery, { api: this.d.api, url: this.d.url, stage: this.stage, artifact: this.artifact,
      onPreview: () => { this.previewing = true; clearTimeout(this.reportTimer); }, study: r => this.studySetup(r) });
    this.browsing = true; this.host.classList.add('tv-browsing');
    this.el.gallery.hidden = false; this.el.state.textContent = '';
    this.galleryLoading = this.gallery.load();
  }
  /* back to the conversation; a preview on the stage gives way to the tutor's own visual (or the pane closes) */
  closeGallery(restore = true) {
    if (!this.browsing) return;
    this.browsing = false; this.host.classList.remove('tv-browsing');
    this.el.gallery.hidden = true;
    const was = this.previewing; this.previewing = false;
    this.gallery?.cancel();   // a preview still loading never reaches the stage
    if (this.artifact.sceneHandle || this.artifact.sceneHost) this.quietly(() => this.artifact.open(false, false));   // a mounted Daily scene never outlives the gallery
    if (!restore) return;
    this.renderStatus();
    if (was) { if (this.thread?.artifact?.status === 'ready') this.syncVisual(true); else { this.quietly(() => this.artifact.open(false, false)); this.stage.pause(); } }
  }
  /* Study this setup: the recipe's course thread attaches library:<id> through normal thread creation (same switching
     and busy rules as any problem); the server's own refusal text is shown in the gallery and the draft is kept. */
  async studySetup(recipe) {
    const course = recipe.course_id || this.courseId; if (!course) throw new Error('No course to study this in.');
    this.gallery?.cancel();   // a preview still loading must not land on top of the studied thread
    if (this.courseId === course) this.saveDraft();
    const t = await this.post('/api/teacher/threads', { course_id: course, problem_id: 'library:' + recipe.id, request_id: 'library-' + rid() });
    if (this.courseId !== course) { this.saveDraft(); this.saveScroll(); this.rememberTime(); this.courseId = course; store.set('course', course); }
    this.closeGallery(false);
    this.el.crumb.textContent = this.courses.find(c => c.id === t.course_id)?.title || t.title || 'Tutor';
    this.setThread(t, { restore: true });
    this.toBottom(false);
  }

  // ── attachments ───────────────────────────────────────────────────────────────────────────────────────────────
  remember(a) { (this.known ||= new Map()).set(a.id, a); }
  /* a screenshot dropped or pasted anywhere lands in the chat composer, whatever page is open */
  intake(files) { if (this.page || this.studyShown) this.leaveViews(); return this.addFiles(files); }
  async shot() {
    const anchor = document.getElementById('tv-shot');
    if (isShotPickerOpen(anchor)) return closeScreenshotPicker();   // the same button closes its open popover
    if (this.capturing || !this.courseId) return;
    this.capturing = true; this.note('');
    const key=this.draftKey(), epoch=this.navigationEpoch;
    try { const f = await captureScreen({url:this.d.url, anchor}); if (f && key===this.draftKey() && epoch===this.navigationEpoch && !this.page) await this.addFiles([f]); }
    catch (e) { this.note('The screenshot could not be attached (' + (e.message || e.name) + ').'); }
    finally { this.capturing = false; }
  }
  async addFiles(files) {
    if (!this.courseId) return;
    const room = MAX_FILES - this.pendingFiles.length;
    if (files.length > room) this.note(`Up to ${MAX_FILES} files per message.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = rid().slice(0, 12), name = file.name || 'pasted image.png';
      const ok = /^image\/(png|jpeg|gif|webp)$|^application\/pdf$|^text\/(plain|markdown)$/.test(file.type) || /\.(png|jpe?g|gif|webp|pdf|txt|md)$/i.test(name);
      const f = { key, name, kind: file.type.startsWith('image/') ? 'image' : /pdf/.test(file.type) || /\.pdf$/i.test(name) ? 'pdf' : 'text' };
      if (!ok) { f.error = 'Only images, PDFs and text files'; f.kind = 'file'; }
      else if (file.size > MAX_BYTES) f.error = 'Larger than 20 MB';
      if (f.kind === 'image' && !f.error) f.preview = URL.createObjectURL(file);
      this.pendingFiles.push(f); this.renderFiles(); this.syncSend();
      if (f.error) continue;
      f.file = file; this.uploadOne(f);
    }
  }
  async uploadOne(f) {
    const ownerKey = this.draftKey(), ownerText = this.el.input.value;
    const fd = new FormData(); fd.append('course_id', this.courseId); fd.append('files', f.file, f.name);
    f.progress = 0; f.error = null; f.abort = new AbortController();
    try {
      const r = await upload(this.d.url('/api/teacher/attachments'), fd, { signal: f.abort.signal, onProgress: p => { f.progress = p; paintProgress(this.el.attach, f); } });
      const a = r.attachments?.[0]; if (!a?.id) throw new Error('The upload was not accepted');
      Object.assign(f, { id: a.id, name: a.name || f.name, kind: a.kind || f.kind, url: a.url || null, file: null }); this.remember(f);
    } catch (e) { if (e.name === 'AbortError') return; f.error = e.message; }
    if (this.pendingFiles.includes(f)) { this.renderFiles(); this.saveDraft(); this.syncSend(); }
    else if (f.id) {
      const saved = store.get(ownerKey) || { text: ownerText, files: [] };
      saved.files = [...(saved.files || []).filter(x => x.key !== f.key), ...[{ key: f.key, id: f.id, name: f.name, kind: f.kind, url: f.url }]];
      store.set(ownerKey, saved);
    }
  }
  renderFiles() {
    this.el.attach.innerHTML = this.pendingFiles.map(f => tileHTML(f, this.d.url)).join('');
    this.el.attach.hidden = !this.pendingFiles.length;
  }

  // ── drafts and scroll position survive reloads, other devices and switching ───────────────────────────────────
  saveDraft() {
    if (!this.courseId) return;
    const prev = store.get(this.draftKey()) || {};
    (this.draftFiles ||= new Map()).set(this.draftKey(), [...this.pendingFiles]);
    const files = this.pendingFiles.filter(f => f.id).map(({ key, id, name, kind, url }) => ({ key, id, name, kind, url }));
    const text = this.el.input.value;
    if (!text && !files.length && !this.stepReference) store.set(this.draftKey(), null);
    else if (!store.set(this.draftKey(), { text, files, stepReference:this.stepReference, request_id: text === prev.text && JSON.stringify(this.stepReference)===JSON.stringify(prev.stepReference) ? prev.request_id || null : null })) this.note('This browser could not save your draft; keep this tab open until you send it.');
    this.saveServerDraft(text);
  }
  saveServerDraft(text) {
    const t = this.thread; if (!t || t.reading || (t.draft || '') === text) return;
    t.draft = text;
    clearTimeout(this.serverDraftTimer);
    const send = () => this.d.api(this.d.url(`/api/teacher/threads/${encodeURIComponent(t.id)}/draft`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), keepalive: true }).catch(() => {});
    if (document.visibilityState === 'hidden') send(); else this.serverDraftTimer = setTimeout(send, 600);
  }
  restoreDraft() {
    const d = store.get(this.draftKey()) || (this.thread?.draft ? { text: this.thread.draft } : null) || {};
    this.stepReference=d.stepReference||null;this.refs?.render();this.el.input.value = d.text || ''; this.pendingFiles = this.draftFiles?.get(this.draftKey()) || (d.files || []).map(f => ({ ...f })); this.pendingFiles.forEach(f => this.remember(f));
    this.renderFiles(); this.fit(); this.note(''); this.syncSend();
  }
  nearBottom() { const s = this.el.scroll; return s.scrollHeight - s.scrollTop - s.clientHeight < 80; }
  syncLatest() { this.el.latest.hidden = !studyChrome(this.thread, { loading: !!this.threadLoading, nearBottom: this.nearBottom() }).jump; }
  toBottom(smooth) { const s = this.el.scroll; this.pinned = true; this.reading = null; this.autoUntil = performance.now() + (smooth ? 900 : 120); const starter=this.thread?.mode==='simulation'&&!this.thread.messages?.length&&this.artifact.inline&&!this.page; s.scrollTo({ top: starter ? 0 : s.scrollHeight, behavior: smooth && !this.stage.reducedMotion() ? 'smooth' : 'auto' }); }
  saveScroll() {
    if (!this.thread || !this.active) return;
    this.workspace.remember();
    if (this.nearBottom()) { store.set('scroll.' + this.thread.id, null); return; }
    store.set('scroll.' + this.thread.id, this.readingAt());
  }
  readingAt() {   // the first message still visible at the top, and where it sits
    const top = this.el.scroll.getBoundingClientRect().top;
    const node = [...this.el.stream.querySelectorAll('[data-mid]')].find(n => { const b = n.getBoundingClientRect(); return b.height > 0 && b.bottom > top + 4; });
    const offset = node && node.getBoundingClientRect().top - top;
    return node ? { mid: node.dataset.mid, offset, docTop: offset + this.el.scroll.scrollTop } : null;
  }
  holdReading() {
    const at = this.reading, node = at && this.el.stream.querySelector(`[data-mid="${CSS.escape(at.mid)}"]`);
    if (!node || !Number.isFinite(at.docTop)) return;
    const s = this.el.scroll;
    // Correct only layout growth, in document coordinates. Momentum is the reader's
    // movement, not drift to undo. Native anchoring is disabled on this scroller.
    const docTop = node.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop;
    if (Math.abs(docTop - at.docTop) > .5) s.scrollTop += docTop - at.docTop;
    this.reading = this.readingAt();
  }
  restoreScroll(at = this.thread && store.get('scroll.' + this.thread.id)) {
    this.reading = at || null; this.autoUntil = performance.now() + 150;   // a clamped jump must not replace the anchor
    const node = at && this.el.stream.querySelector(`[data-mid="${CSS.escape(at.mid)}"]`);
    if (!node) {
      if (this.workspace.manages() && !this.thread.messages?.length) {
        this.el.scroll.scrollTop = this.workspace.position(); this.pinned = false; return;
      }
      if (this.thread?.book_problem && !this.thread.messages?.length) {
        this.el.scroll.scrollTop = 0; this.pinned = false; this.reading = this.readingAt(); return;
      }
      return this.toBottom(false);
    }
    const s = this.el.scroll; s.scrollTop += node.getBoundingClientRect().top - s.getBoundingClientRect().top - at.offset;
    this.reading = this.readingAt();
  }

  // ── small dialogs: materials, sources and cards ───────────────────────────────────────────────────────────────
  // ── chat menu (rename, pin, notify, share, delete) ───────────────────────────────────────────────
  rowOf(id) { return this.threads.find(t => t.id === id); }
  openMenu(id, anchor, at) {
    const r = this.rowOf(id); if (!r) return;
    this.closeMenu();
    const cm = this.el.cm;
    cm.innerHTML = `<button type="button" role="menuitem" data-act="cm" data-op="rename" data-id="${esc(id)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 16 1-4 8.5-8.5a1.6 1.6 0 0 1 2.3 2.3L7.3 14.3Z"/></svg>Rename</button>
      <button type="button" role="menuitem" data-act="cm" data-op="pin" data-id="${esc(id)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6l-1 5 3 3H5l3-3Zm3 8v6"/></svg>${r.pinned ? 'Unpin' : 'Pin'}</button>
      <button type="button" role="menuitemcheckbox" aria-checked="${!!r.notify}" data-act="cm" data-op="notify" data-id="${esc(id)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 1.5h-13ZM8.5 17.5h3"/></svg>Notify when it replies<i class="tv-tick" aria-hidden="true">${r.notify ? '✓' : ''}</i></button>
      <button type="button" role="menuitem" data-act="cm" data-op="share" data-id="${esc(id)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12V3.5M6.5 7 10 3.5 13.5 7M4.5 11v5h11v-5"/></svg>Share chat</button>
      <hr><button type="button" role="menuitem" class="danger" data-act="cm" data-op="delete" data-id="${esc(id)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4h4v2M6 6l.7 10h6.6L14 6"/></svg>Delete chat</button>`;
    cm.hidden = false;
    const box = anchor?.getBoundingClientRect(), w = cm.offsetWidth, h = cm.offsetHeight;
    let x = at ? at.x : box.right - w, y = at ? at.y : box.bottom + 4;
    x = Math.max(8, Math.min(x, innerWidth - w - 8)); y = Math.max(8, Math.min(y, innerHeight - h - 8));
    cm.style.left = x + 'px'; cm.style.top = y + 'px';
    this.menuFor = id; this.menuAnchor = anchor;
    cm.querySelector('button').focus({ preventScroll: true });
    const away = ev => { if (!cm.contains(ev.target)) this.closeMenu(); };
    const keys = ev => {
      const items = [...cm.querySelectorAll('button')], i = items.indexOf(document.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); this.closeMenu(true); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      else if (ev.key === 'Tab') this.closeMenu();
    };
    this.menuOff = () => { document.removeEventListener('pointerdown', away, true); cm.removeEventListener('keydown', keys); removeEventListener('resize', this.menuOff); };
    document.addEventListener('pointerdown', away, true); cm.addEventListener('keydown', keys); addEventListener('resize', this.menuOff);
  }
  closeMenu(refocus = false) {
    if (this.el.cm.hidden) return;
    this.el.cm.hidden = true; this.menuOff?.(); this.menuOff = null;
    if (refocus) this.menuAnchor?.focus?.();
  }
  async menuAction(op, id) {
    this.closeMenu();
    const r = this.rowOf(id); if (!r) return;
    if (op === 'rename') return this.renameDialog(r);
    if (op === 'pin') return this.manage(id, { pinned: !r.pinned });
    if (op === 'notify') {
      if (!r.notify && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* the in-app alert still works */ } }
      return this.manage(id, { notify: !r.notify }, !r.notify ? 'You will be told when this chat replies.' : '');
    }
    if (op === 'share') return this.shareDialog(r);
    if (op === 'delete') return this.deleteDialog(r);
  }
  async manage(id, body, say = '') {
    try {
      const row = await this.post(`/api/teacher/threads/${encodeURIComponent(id)}/manage`, body);
      const i = this.threads.findIndex(x => x.id === id);
      if (i >= 0) this.threads[i] = { ...this.threads[i], ...row };
      if (this.thread?.id === id) { Object.assign(this.thread, { pinned: row.pinned, notify: row.notify, label: row.label }); this.setCrumb(); }
      this.renderThreads(); if (say) this.toast(say);
      return true;
    } catch (e) { this.toast('Could not change the chat: ' + e.message); return false; }
  }
  toast(text, openId = '') {
    const t = this.el.toast; clearTimeout(this.toastTimer);
    t.innerHTML = `<span>${esc(text)}</span>${openId ? `<button type="button" data-act="toast-open" data-id="${esc(openId)}">Open</button>` : ''}`;
    t.hidden = false; this.toastTimer = setTimeout(() => { t.hidden = true; }, openId ? 9000 : 3500);
  }
  notifyDone(id, name) {
    const here = this.thread?.id === id && !this.page && !this.studyShown;
    if (here && !document.hidden) return;
    this.toast(`Reply ready: ${name || 'chat'}`, id);
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Kinema', { body: 'Reply ready: ' + (name || 'chat'), tag: 'kinema-' + id }); } catch { /* the in-app alert is enough */ }
  }
  async pollNotify() {
    const watch = this.threads.filter(t => t.notify && t.pending && t.id !== this.thread?.id);
    if (!watch.length || this.pollingNotify) return;
    this.pollingNotify = true;
    try {
      const b = await this.d.api(this.d.url('/api/teacher/bootstrap'));
      for (const w of watch) {
        const n = (b.threads || []).find(x => x.id === w.id);
        if (!n) continue;
        const i = this.threads.findIndex(x => x.id === w.id); if (i >= 0) this.threads[i] = { ...this.threads[i], ...n };
        if (!n.pending) this.notifyDone(w.id, n.label || n.title);
      }
      this.renderThreads();
    } catch { /* try again on the next tick */ } finally { this.pollingNotify = false; }
  }
  renameDialog(r) {
    this.dialog('Rename chat', `<form class="tv-form"><input type="text" id="tv-name" maxlength="80" value="${esc(r.label || r.title)}" aria-label="Chat name"><div class="tv-foot"><button type="button" class="tv-btn" data-act="dialog-close">Cancel</button><button type="submit" class="tv-btn primary">Save</button></div></form>`);
    const f = this.el.dialog.querySelector('form'), inp = f.querySelector('input'); inp.focus(); inp.select();
    f.onsubmit = async e => { e.preventDefault(); if (await this.manage(r.id, { name: inp.value })) this.el.dialog.close(); };
  }
  deleteDialog(r) {
    this.dialog('Delete chat?', `<p class="tv-dp">“${esc(r.label || r.title)}” and its messages will be removed. This cannot be undone.</p><div class="tv-foot"><button type="button" class="tv-btn" data-act="dialog-close">Cancel</button><button type="button" class="tv-btn danger" id="tv-del">Delete</button></div>`);
    const b = this.el.dialog.querySelector('#tv-del'); this.el.dialog.querySelector('.tv-btn').focus();
    b.onclick = async () => {
      b.disabled = true;
      try {
        await this.d.api(this.d.url('/api/teacher/threads/' + encodeURIComponent(r.id)), { method: 'DELETE' });
      } catch (e) { b.disabled = false; return this.toast(e.status === 409 ? 'It is replying. Stop it first, then delete.' : 'Could not delete: ' + e.message); }
      this.el.dialog.close();
      this.threads = this.threads.filter(x => x.id !== r.id); store.set('draft.' + r.id, null);
      if (this.thread?.id === r.id) {
        this.thread = null;
        const next = this.latestThread(this.courseId);
        if (next) await this.openThread(next.id); else await this.startCourse();
      } else this.renderThreads();
      this.toast('Chat deleted.');
    };
  }
  shareDialog(r) {
    const page = new URL(this.d.url('/api/teacher/threads/' + encodeURIComponent(r.id) + '/share'), location.href).href;
    this.dialog('Share chat', `<p class="tv-dp">The page and its link open on this computer. Copy the text to share it elsewhere.</p><div class="tv-share"><a class="tv-btn" href="${esc(page)}" target="_blank" rel="noopener">Open as page</a><button type="button" class="tv-btn" id="tv-cl">Copy local link</button><button type="button" class="tv-btn" id="tv-ct">Copy text</button></div><p class="tv-dp tv-dim" id="tv-sh"></p>`);
    const say = t => { const n = this.el.dialog.querySelector('#tv-sh'); if (n) n.textContent = t; };
    const copy = async text => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };
    this.el.dialog.querySelector('#tv-cl').onclick = async () => say(await copy(page) ? 'Link copied.' : 'Copy failed. Use Open as page.');
    this.el.dialog.querySelector('#tv-ct').onclick = async () => {
      try {
        const t = await this.d.api(this.d.url('/api/teacher/threads/' + encodeURIComponent(r.id)));
        const text = (t.messages || []).filter(m => (m.text || '').trim()).map(m => (m.role === 'user' ? 'You' : 'Kinema') + ':\n' + m.text.trim()).join('\n\n');
        say(await copy(text) ? 'Text copied.' : 'Copy failed.');
      } catch (e) { say('Could not read the chat: ' + e.message); }
    };
  }
  /* What is on screen beside the chat: the exact lesson step (topic companion) and, when the visual exposes it, its focus.
     Either is omitted when absent, so the tutor behaves as before. */
  screenContext() {
    const out = {};
    try { const step = window.KinemaCompanion?.getVisibleContext?.(); if (step && typeof step === 'object' && (step.title || step.text)) out.visible_step = step; } catch { /* no companion */ }
    try { const focus = window.KinemaFocus?.current?.(); if (focus && typeof focus === 'object') out.visual_focus = focus; } catch { /* no focus hook */ }
    const revealed = this.workspace.visibleContext(); if (revealed) out.visible_step = revealed;
    const shelf = this.studyPane?.visibleContext(); if(shelf)out.visible_step=shelf;
    return out;
  }
  // ── Study path: a light page ───────────────────────────────────────────────────────────────────
  // The chapter map is cached: Back and re-entry paint instantly from it and restore the scroll
  // position of that view, while one deduped request refreshes the learning evidence in the
  // background. A quiet skeleton shows only on a cold load; stale responses never paint.
  pathKey() { return this.ppOpen ? 'ch:' + this.ppOpen : 'list'; }
  savePathScroll() { if (this.page === 'path' && this.ppShown) (this.ppScroll ||= {})[this.ppShown] = this.el.page.scrollTop; }
  async renderPathPage(enter = false) {
    const box = this.el.pathpage, seq = this.ppSeq = (this.ppSeq || 0) + 1;
    const paint = () => {
      const open = this.chMap.find(c => String(c.n) === String(this.ppOpen));
      if (this.ppOpen && !open) this.ppOpen = null;
      const key = this.pathKey(), html = open ? this.chapterDetail(open) : this.chapterList(), same = this.ppShown === key;
      const top = this.el.page.scrollTop, back = this.book.returnScroll;
      const changed = !same || this.ppHTML !== html || !box.firstElementChild;
      if (changed) { box.innerHTML = html; this.ppHTML = html; this.ppShown = key; this.book.mountChapter(); }
      if (back && open && String(back.chapter) === String(open.n)) return;   // the book browser restores its own place
      if (!same || enter) this.el.page.scrollTop = this.ppScroll?.[key] || 0;
      else if (changed) this.el.page.scrollTop = top;
    };
    if (this.chMap) { paint(); enter = false; }
    else box.innerHTML = '<div class="pg-col pp-skel" aria-busy="true" aria-label="Loading chapters"><i></i><i></i><i></i><i></i><i></i></div>';
    let r;
    try { r = await (this.chMapFetch ||= this.d.api(this.d.url('/api/chapter-map')).finally(() => { this.chMapFetch = null; })); }
    catch (e) {
      if (seq !== this.ppSeq || this.page !== 'path' || this.chMap) return;   // a warm page keeps what it shows
      box.innerHTML = `<div class="pg-col"><p class="pg-note">Could not load chapters: ${esc(e.message)}</p><button type="button" class="pp-retry" data-act="pp-retry">Try again</button></div>`;
      return;
    }
    if (Array.isArray(r?.chapters)) this.chMap = r.chapters;
    if (seq !== this.ppSeq || this.page !== 'path' || !this.chMap) return;
    paint();
  }
  chapterList() {
    const label={known:'Known',shaky:'Shaky',weak:'Weak',partial:'Partly checked'};
    const row=c=>{const ev=c.evidence||{},badge=progressBadge(c,true)||(label[ev.state]?`<em class="pp2-${ev.state}">${label[ev.state]}</em>`:'');
      return `<li><button type="button" class="pp2-row pp2-ch" data-act="pp-open" data-n="${esc(c.n)}" aria-label="Open ${c.math?'':'chapter '}${esc(c.n)} ${esc(c.title)}"><b class="pp2-ch-number">${c.math?'MATH':'CHAPTER '+esc(c.n)}</b><span class="pp2-ch-title">${esc(c.title)}</span><span class="pp2-ch-meta">${badge}${c.primary?'':'<i class="pp2-supp">Supplemental</i>'}<span data-reading-record="${esc(c.n)}" data-reading-chapter="true">${this.workspace.history.line(c.n,true)}</span></span></button></li>`;};
    return `<div class="pg-col pp2 pp2-overview"><h1 class="pg-h">Chapters</h1>${this.book.chooser()}<div data-reading-save-status>${this.workspace.history.status()}</div><ol class="pp2-list" aria-label="Chapters and the maths used across the course">${this.chMap.map(row).join('')}</ol><p class="pg-note pp2-foot">Viewed tracks reading time. Learning progress reflects your answers.</p></div>`;
  }
  chapterDetail(c) {
    const label={known:'Known',shaky:'Shaky',weak:'Weak',partial:'Partly checked'};
    const badge=s=>progressBadge(s)||(label[s.evidence?.state]?`<em class="pp2-${s.evidence.state}">${label[s.evidence.state]}</em>`:'');
    const link=(id,title,ctx,sub=false)=>{
      const inner=`<b>${esc(id)}</b><span>${esc(title)}<span class="pp2-lesson-meta">${badge(sub?{}:c.groups.flatMap(g=>g.sections).find(s=>s.id===id)||{})}</span></span>`;
      return ctx&&!sub?`<button type="button" class="pp2-row" data-act="pp-ask" data-ctx="${esc(JSON.stringify(ctx))}" aria-label="Learn section ${esc(id)} ${esc(title)}">${inner}</button>`:`<span class="pp2-row pp2-static${sub?' pp2-subrow':''}">${inner}</span>`;
    };
    const sec=s=>{const subs=c.math?[]:(s.topics||[]).filter(t=>t.kind==='sub');
      return `<li class="pp2-section" data-sec="${esc(s.id)}">${link(s.id,s.title,!c.math&&s.teachable?s.launch:null)}${subs.length?`<ul class="pp2-sub" aria-label="Inside ${esc(s.id)}">${subs.map(t=>`<li>${link(t.id,t.title,t.launch,true)}</li>`).join('')}</ul>`:''}</li>`;
    };
    const grp=g=>`<section class="pp2-grp" aria-label="${esc(g.title)}"><h2>${esc(g.title)}</h2><ul class="pp2-list">${g.sections.map(sec).join('')}</ul></section>`;
    return `<div class="pg-col pp2 pp2-detail"><button type="button" class="pp-back" data-act="pp-back">${controlIcon('left')} Chapters</button><header class="pp2-heading"><span class="pp2-eyebrow">${c.math?'Maths used across the course':'Chapter '+esc(c.n)}</span><h1 class="pg-h">${esc(c.title)}</h1></header><div data-reading-save-status>${this.workspace.history.status()}</div>${this.book.tabs(c)}${!c.math&&this.book.state(c.n).tab==='problems'?this.book.browser(c):`<div class="pp2-groups">${c.groups.map(grp).join('')}</div><details class="pp2-reading-history"><summary>Reading history</summary><div>${c.groups.flatMap(g=>g.sections).flatMap(s=>[s,...(s.topics||[]).filter(t=>t.kind==='sub')]).map(s=>`<div><span>${esc(s.id)} ${esc(s.title)}</span><span data-reading-record="${esc(s.id)}">${this.workspace.history.line(s.id)}</span></div>`).join('')}</div></details>`}</div>`;
  }
  dialog(title, body) {
    const d = this.el.dialog;
    d.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" data-act="dialog-close" aria-label="Close">×</button></header><div class="tv-dialog-body">${body}</div>`;
    if (!d.open) d.showModal();
  }
  /* Library > Materials: course files and uploaded quizzes or homework as cards, with an Upload button that keeps the
     learner here: each file shows its progress, a Retry on failure, and lands in the list when stored. */
  materialsHTML() {
    return `<div class="mt-head"><p class="mt-sub" data-i18n="materials_sub">Quizzes, homework and course files the tutor can read.</p>
      <div class="mt-up">
      <button type="button" class="mt-upload" data-act="mt-pick"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg><span data-i18n="upload">Upload</span></button>
      <input type="file" data-mt-file accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" multiple hidden></div></div>
      <div class="mt-queue" aria-live="polite"></div><div class="mt-list"><div class="mt-grid mt-skel" aria-busy="true"><i></i><i></i><i></i></div></div>`;
  }
  async loadMaterials(box) {
    if (!box.querySelector('.mt-head')) {
      box.innerHTML = this.materialsHTML();
      box.querySelector('[data-mt-file]').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; files.forEach(f => this.uploadMaterial(box, f)); });
    }
    this.paintMaterialQueue(box);
    const seq = this.mtSeq = (this.mtSeq || 0) + 1, list = box.querySelector('.mt-list');
    let r;
    try { r = await this.d.api(this.d.url('/api/teacher/materials?course_id=' + encodeURIComponent(this.courseId || ''))); }
    catch (e) { if (seq === this.mtSeq) list.innerHTML = `<p class="pg-note">Could not load materials: ${esc(e.message)} <button type="button" class="pp-retry" data-act="mt-reload">Try again</button></p>`; return; }
    if (seq !== this.mtSeq) return;
    // The textbook is the tutor's private source, not a reading entry point. Uploads come first, newest first.
    const rows = (r.materials || []).filter(m => m.kind !== 'book').sort((x, y) => (y.uploaded ? 1 : 0) - (x.uploaded ? 1 : 0) || (y.created_ts || 0) - (x.created_ts || 0));
    for (const m of rows) if (m.pages) (this.srcPages ||= {})[m.id] = m.pages;
    const course = String(r.course?.title || '').replace(/\s*·\s*/g, ' ');
    const type = m => m.material_type === 'quiz' || (!m.material_type && /\bquiz/i.test(m.title || '')) ? 'Quiz' : m.material_type === 'homework' || (!m.material_type && /\b(homework|hw|assignment|problem set)\b/i.test(m.title || '')) ? 'Homework'
      : { notes: 'Notes', document: 'Scans', pdf: 'PDF', image: 'Photo', text: 'Text' }[m.kind] || 'File';
    const when = ts => ts ? new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: new Date(ts * 1000).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
    const glyph = m => m.kind === 'image' ? '<path d="M4 5h16v14H4z"/><path d="m4 16 5-5 4 4 3-3 4 4"/><circle cx="15.5" cy="9" r="1.4"/>' : '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>';
    const card = m => {
      const meta = [type(m), m.pages ? m.pages + (m.pages === 1 ? ' page' : ' pages') : '', when(m.created_ts), course].filter(Boolean);
      const inner = `<span class="mt-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${glyph(m)}</svg></span><span class="mt-tx"><b>${esc(m.uploaded ? String(m.title).replace(/\.(pdf|png|jpe?g|gif|webp|txt|md)$/i, '') : m.title)}</b><small>${esc(meta.join(' · '))}</small></span>`;
      const fresh = this.mtFresh?.has(m.id) ? ' mt-new' : '';
      return m.uploaded
        ? `<a class="mt-card${fresh}" href="${esc(this.d.url(m.url))}" target="_blank" rel="noopener" title="${esc(m.title)}">${inner}</a>`
        : `<button type="button" class="mt-card${fresh}" data-act="source" data-url="${esc(String(m.url).replace(/^\/api\/apps\/kinema\/view(?=\/)/, ''))}" data-title="${esc(m.title)}" title="${esc(m.description || m.title)}">${inner}</button>`;
    };
    list.innerHTML = rows.length ? `<div class="mt-grid">${rows.map(card).join('')}</div>` : '<p class="mt-empty" data-i18n="materials_empty">No materials yet. Upload a quiz or homework as a PDF or photo.</p>';
  }
  paintMaterialQueue(box) {
    const q = box.querySelector('.mt-queue'); if (!q) return;
    q.innerHTML = (this.mtQueue || []).map(f => `<div class="mt-job${f.error ? ' err' : ''}" data-key="${esc(f.key)}"><span class="mt-jn">${esc(f.name)}</span>
      ${f.error ? `<span class="mt-je" role="alert">${esc(f.error)}</span><button type="button" class="pp-retry" data-act="mt-retry" data-key="${esc(f.key)}" data-i18n="retry">Retry</button><button type="button" class="mt-x" data-act="mt-dismiss" data-key="${esc(f.key)}" aria-label="Dismiss">×</button>`
        : `<span class="mt-bar" role="progressbar" aria-label="Uploading ${esc(f.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((f.progress || 0) * 100)}"><i style="width:${Math.round((f.progress || 0) * 100)}%"></i></span><span class="mt-pc">${Math.round((f.progress || 0) * 100)}%</span>`}</div>`).join('');
  }
  async uploadMaterial(box, file, f = null) {
    if (!f) { f = { key: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), file, name: file.name, type: 'other' }; (this.mtQueue ||= []).push(f); }
    f.error = ''; f.progress = 0; this.paintMaterialQueue(box);
    const fd = new FormData();
    fd.append('course_id', this.courseId || ''); fd.append('purpose', 'material'); fd.append('material_type', f.type); fd.append('files', f.file, f.name);
    try {
      const r = await upload(this.d.url('/api/teacher/attachments'), fd, { onProgress: p => { f.progress = p; const bar = box.querySelector(`.mt-job[data-key="${CSS.escape(f.key)}"]`);
        if (bar) { const pc = Math.round(p * 100); bar.querySelector('.mt-bar i')?.style.setProperty('width', pc + '%'); bar.querySelector('.mt-bar')?.setAttribute('aria-valuenow', pc); const t = bar.querySelector('.mt-pc'); if (t) t.textContent = pc + '%'; } } });
      for (const a of r.attachments || []) (this.mtFresh ||= new Set()).add(a.id);
      this.mtQueue = this.mtQueue.filter(x => x !== f);
      this.toast(f.name + ' uploaded.');
    } catch (e) { f.error = e.message || 'The upload failed.'; }
    if (box.isConnected) this.loadMaterials(box);
  }
  /* Library > Graphs: editable graphs kept in chats open their chat; the prepared graph setups open in the same
     editable graph view as Simulations (the visual library's own preview). */
  async loadGraphs(box) { return mountLibraryGraphs(box, this); }
  async previewGraph(id, button) {
    const epoch=this.libraryPreviewEpoch;
    this.openGallery();
    await this.galleryLoading;
    if(epoch!==this.libraryPreviewEpoch||this.page!=='library'||!button?.getClientRects().length)return;
    if (!this.gallery?.data) return this.toast(this.gallery?.error || 'Could not load the graph library.');
    this.grShown = id;
    this.el.page.querySelectorAll('[data-act="gr-preview"]').forEach(b => { const on = b.dataset.id === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    await this.gallery.act('preview', id, button);
    if (this.gallery.msg?.err && this.gallery.msg.id === id) this.toast(this.gallery.msg.text);
  }
  /* a cited page (text and, for the book, the page image) or a material's sections; links inside stay in this reader */
  async showSource(url, title) {
    this.dialog(title || 'Source', '<p class="dialog-note">Loading…</p>');
    try {
      let s = await this.d.api(this.d.url(url));
      if (s.pages) (this.srcPages ||= {})[s.id] = s.pages;
      // a quiz, slides or scans file: it opens at its first page, then pages through
      if (s.page == null && s.pages > 0 && !s.sections?.length && !s.modules?.length && !s.text) s = await this.d.api(this.d.url(url + (url.includes('?') ? '&' : '?') + 'page=1'));
      // a citation opened straight at a page: learn the page counts once from the materials list, so Next stops at the end
      if (s.page != null && !this.srcPages?.[s.id] && this.srcIndexed !== this.courseId) {
        this.srcIndexed = this.courseId;
        try { for (const m of (await this.d.api(this.d.url('/api/teacher/materials?course_id=' + encodeURIComponent(this.courseId || '')))).materials || []) if (m.pages) (this.srcPages ||= {})[m.id] = m.pages; } catch { }
      }
      const head = s.title || title || 'Source', total = this.srcPages?.[s.id];
      const at = p => `/api/teacher/sources/${encodeURIComponent(s.id)}?course_id=${encodeURIComponent(this.courseId || '')}&page=${p}`;
      const pager = s.page != null && (s.kind === 'pdf' || s.kind === 'document') ? `<nav class="tv-pager" aria-label="Pages">${s.page > 1 ? `<button type="button" class="tv-btn" data-act="source" data-url="${esc(at(s.page - 1))}" aria-label="Previous page">${controlIcon('left')} Previous</button>` : '<span></span>'}<span>Page ${esc(s.page)}${total ? ' of ' + esc(total) : ''}</span>${!total || s.page < total ? `<button type="button" class="tv-btn" data-act="source" data-url="${esc(at(s.page + 1))}" aria-label="Next page">Next ${controlIcon('right')}</button>` : '<span></span>'}</nav>` : '';
      const caution = s.caution ? `<p class="dialog-note tv-caution">${esc(s.caution)}</p>` : '';
      const sub = rows => `<ul class="tv-materials">${rows.flatMap(x => [x, ...(x.sections || []).map(y => ({ ...y, sub: true }))]).map(x => { const p = x.page ?? x.start_page ?? null; const u = `/api/teacher/sources/${encodeURIComponent(s.id)}?course_id=${encodeURIComponent(this.courseId || '')}` + (p != null ? '&page=' + encodeURIComponent(p) : ''); return `<li${x.sub ? ' class="tv-sub"' : ''}>${p != null ? this.sourceChip(u, x.title || x.name || 'Page ' + p).replace('class="fchip"', 'class="tv-link"') : esc(x.title || x.name || '')}${p != null ? `<small>p. ${esc(p)}</small>` : ''}</li>`; }).join('')}</ul>`;
      const list = s.sections || s.modules;
      const paras = tidySource(s.text);
      const scan = s.image_url ? `<details class="tv-scan"${s.text ? '' : ' open'}><summary>${s.text ? 'Show the printed page' : 'The printed page'}</summary><img class="tv-page" loading="lazy" src="${esc(this.d.url(s.image_url))}" alt="Scan of ${esc(head)}"><p class="dialog-note tv-scanfail" hidden>The picture of this page did not load. The text above is the same page.</p></details>` : '';
      this.dialog(head, caution + pager + (paras ? `<div class="tv-source-text" lang="en" tabindex="0" role="region" aria-label="Text of ${esc(head)}">${paras}</div>` : '') + scan + (Array.isArray(list) && list.length ? sub(list) : '') + (!s.text && !s.image_url && !list?.length ? '<p class="dialog-note">Nothing to show for this source.</p>' : '') + (pager && (s.text || s.image_url) ? pager : ''));
      const im = this.el.dialog.querySelector('img.tv-page');
      if (im) { const bad = () => { im.hidden = true; const n = this.el.dialog.querySelector('.tv-scanfail'); if (n) n.hidden = false; }; im.addEventListener('error', bad); if (im.complete && im.naturalWidth === 0 && im.currentSrc) bad(); }
    } catch (e) { this.dialog(title || 'Source', `<p class="dialog-note">Could not open this source: ${esc(e.message)}</p>`); }
  }
  // ── studying in place of the chat: the study path, guided steps and course cards ──────────────────────────────
  /* Guide pages stay linked to the tutor. Flashcard UI lives in Recall; its records remain in place. */
  async openStudy(mode = 'path', { shown = true, resume = false } = {}) {
    if (mode !== 'path') return;   // obsolete persisted card navigation cannot mount a native deck
    this.closePage(false);
    this.studyMode = 'path'; this.saveStudy(); this.el.sp.hidden = false;
    if (shown) this.showLesson(); else this.renderStatus();
    this.path ||= new StudyPath(this.el.sp, { api: this.d.api, url: this.d.url, post: (p, b) => this.post(p, b),
      renderMap: (box, where) => this.d.renderMap?.(box, where), onAsk: () => this.askHere(), onVisual: () => this.artifact.open(true), onRestore: () => this.restoreGuideSetup(),
      onPlace: () => { this.renderAbout(); this.renderStatus(); this.syncStudyContext(); this.path?.setExploring(this.guideExplored()); } });
    const at = recalled();
    if (resume) { if (!(at?.view === 'guide' && at.session_id && await this.path.openSession(at.session_id))) await this.path.showPath(); }
    else if (this.path.context()) this.syncStudyContext();
    else await this.path.showPath();
    this.renderAbout(); this.renderStatus();
  }
  /* the chat again, keeping the lesson (and its place) one tap away */
  showChat(scroll = true) {
    if (!this.studyShown) return;
    this.attachStudy(false);   // the chat attaches nothing until the student asks about a lesson
    this.studyShown = false; this.host.classList.remove('tv-studying', 'tv-asking'); this.el.study.hidden = true;
    this.saveStudy(); this.setCrumb();
    this.renderStatus(); this.renderAbout(); if (scroll) this.toBottom(false);
  }
  showLesson() {
    if (!this.studyMode) return;
    this.closePage(false);
    this.studyShown = true; this.host.classList.add('tv-studying'); this.host.classList.remove('tv-asking'); this.el.study.hidden = false;
    this.setCrumb();
    this.saveStudy(); this.renderStatus(); this.renderAbout();
    if (this.studyMode === 'path') this.path?.refresh();
  }
  leaveStudy() {
    this.showChat(); this.studyMode = null; store.set('study', null); this.renderStatus(); this.renderAbout();
  }
  saveStudy() {
    if (this.studyMode === 'path') store.set('study', { mode: 'path', shown: !!this.studyShown });
  }
  /* the place being studied, as the server's ID-based reference; never for another course's conversation */
  lessonContext() {
    if (this.studyMode === 'path') return this.path?.context() || null;
    return null;
  }
  messageContext() {
    const c = this.aboutOff ? null : this.lessonContext(), course = c?.course_id || (c?.kind === 'guide' ? this.path?.session?.course_id || '2301' : null);
    return c && (!course || String(course) === String(this.thread?.course_id)) ? c : null;
  }
  renderAbout() {
    const c = this.messageContext();
    this.el.about.hidden = !c;
    const what = c?.kind !== 'card' ? 'step: ' + esc(this.path?.label() || '') : c.mode === 'lesson' ? 'this lesson section' : /check|quiz|mock|diag/.test(c.mode || '') ? 'this question' : 'this card';
    this.el.about.innerHTML = c ? `<span>About ${what}</span><button type="button" data-act="about-clear" aria-label="Ask without this" title="Ask without this">×</button>` : '';
    this.el.input.placeholder = c ? `Ask about ${c.kind === 'card' ? what : 'this step'}…` : 'Ask, or tell the tutor what you want to learn…';
  }
  /* the lesson step or card goes with the next message only after its own Ask (kept across a reload until sent or
     dismissed); opening the chat, a reload or a sent message attaches nothing */
  attachStudy(on) { this.aboutOff = !on; store.set('ask', on && this.thread ? this.thread.id : null); }
  /* Ask from a lesson: the composer opens under the step or card (short windows hide it until asked) */
  askHere() {
    this.attachStudy(true);
    if (this.studyShown) this.host.classList.add('tv-asking');
    this.renderAbout(); this.el.input.focus({ preventScroll: true });
  }
  /* this thread's diagram is the current guide step's, but with values other than the step's prepared ones */
  guideExplored() {
    const ctx = this.studyMode === 'path' && this.path?.context(), g = this.thread?.artifact?.guide;
    if (!ctx || !g || g.session_id !== ctx.session_id || g.step_id !== ctx.step_id || String(this.thread.course_id) !== String(this.path.session?.course_id || '2301')) return false;
    const norm = o => JSON.stringify(Object.entries(o || {}).sort(([a], [b]) => a < b ? -1 : 1));
    if (norm(g.parameters) !== norm(g.prepared)) return true;   // the tutor changed it
    const v = this.visualState();                                // or the student moved a slider here
    return !!(v?.rendered && v.parameters && Object.entries(v.parameters).some(([k, x]) => k in (g.prepared || {}) && Math.abs(x - g.prepared[k]) > 1e-9));
  }
  /* back to the step's authored setup: the server rebuilds the prepared visual; the chat, lesson position and help stay */
  async restoreGuideSetup() {
    const ctx = this.path?.context(); if (!ctx || !this.thread) return false;
    for (let again = true; ; again = false) {
      try {
        const t = await this.post(this.actPath(), { action: 'study_context', revision: this.thread.revision, request_id: rid(), study_context: ctx, restore_visual: true });
        if (this.thread?.id === t.id) this.setThread(t);
        this.ctxSynced = JSON.stringify([t.id, ctx]);
        return !this.guideExplored();
      } catch (e) {
        if (e.status === 409 && e.body?.thread && again) { this.setThread(e.body.thread); continue; }
        this.path?.alert('Not restored: ' + (e.message || 'try again')); return false;
      }
    }
  }
  /* a guide step makes this thread's visual the step's diagram before anything is sent (no message is added) */
  async syncStudyContext() {
    const ctx = this.path?.context(); if (!ctx || this.studyMode !== 'path') return;
    const course = String(this.path.session?.course_id || '2301');
    if (String(this.courseId) !== course && this.courses.some(c => String(c.id) === course)) await this.switchCourse(course);
    if (!this.thread || String(this.thread.course_id) !== course) return;
    const sig = JSON.stringify([this.thread.id, ctx]); if (sig === this.ctxSynced) return;
    this.ctxSynced = sig;
    for (let again = true; ; again = false) {
      try { const t = await this.post(this.actPath(), { action: 'study_context', revision: this.thread.revision, request_id: rid(), study_context: ctx }); if (this.thread?.id === t.id) this.setThread(t); return; }
      catch (e) { if (e.status === 409 && e.body?.thread && again) { this.setThread(e.body.thread); continue; } if (e.status !== 400 && e.status !== 422) this.ctxSynced = null; return; }
    }
  }
}
