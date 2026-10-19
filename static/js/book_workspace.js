import { controlIcon } from './icons.js';
import { esc, mdlite, math } from './md.js';

/* Numbered book content is read-only. Only an explicit composer action asks the tutor. */
export class BookWorkspace {
  constructor(teacher) {
    this.t = teacher; this.states = new Map(); this.sceneSeq = 0; this.savedViews = new Map(); this.focusApplied = new Map();
    teacher.host.addEventListener('click', e => {
      const b = e.target.closest('[data-book]'); if (b) this.click(b, e);
    });
    teacher.host.addEventListener('toggle', e => {
      if (e.target.matches?.('.sw-reference')) this.syncScene();
    }, true);
    // the companion's Solution tab (its own host) changes the displayed step; follow it once the tab has rendered
    document.addEventListener('click', e => { if (e.target.closest?.('[data-topic^="solution"],[data-topic="problem-tab"]')) requestAnimationFrame(() => this.syncFocus()); });
    // lane B's companion (and any solution view) may announce the displayed step directly
    for (const name of ['kinema:companion-step', 'kinema:solution-step']) addEventListener(name, e => this.syncFocus(e.detail));
    teacher.host.addEventListener('input', e => {
      if (!e.target.matches('[data-book-search]')) return;
      const root = e.target.closest('[data-book-browser]'), s = this.state(root.dataset.chapter);
      this.returnScroll = null;
      s.q = e.target.value; s.seq++; s.loaded = false; this.save(root.dataset.chapter); clearTimeout(this.searchTimer);
      const chapter = root.dataset.chapter;
      this.searchTimer = setTimeout(() => {
        // A background chapter refresh may have replaced the input's old root.
        const current = [...teacher.host.querySelectorAll('[data-book-browser]')].find(n => n.dataset.chapter === chapter);
        if (current && !s.loaded) this.load(current, true);
      }, 220);
    });
    teacher.host.addEventListener('change', e => {
      if(e.target.matches('[data-book-kind]')){const root=e.target.closest('[data-book-browser]');this.state(root.dataset.chapter).kind=e.target.value;this.save(root.dataset.chapter);this.returnScroll=null;this.load(root,true);return;}
      if (!e.target.matches('[data-book-scope]')) return;
      const root = e.target.closest('[data-book-browser]'); this.state(root.dataset.chapter).scope = e.target.value; this.save(root.dataset.chapter);
      this.returnScroll = null;
      this.load(root, true);
    });
    teacher.host.addEventListener('error', e => {
      const img = e.target.closest?.('img[data-book-image]'); if (!img) return;
      this.imageStatus(img, false);
    }, true);
    teacher.host.addEventListener('load', e => {
      const img = e.target.closest?.('img[data-book-image]'); if (img) this.imageStatus(img, true);
    }, true);
  }
  state(chapter) {
    const key = String(chapter);
    if (!this.states.has(key)) {
      let saved; try { saved = JSON.parse(sessionStorage.getItem('kinema.book.chapter.' + key)); } catch { }
      const scope = saved?.scope === 'all' || key === 'library' && /^(?:[1-9]|1[0-4])$/.test(saved?.scope) ? saved.scope : key === 'library' ? 'all' : key;
      this.states.set(key, { tab: saved?.tab === 'problems' ? 'problems' : 'lessons', scope,
        q: String(saved?.q || '').slice(0, 160), kind: ['problem','exercise'].includes(saved?.kind) ? saved.kind : '', visual: false, rows: [], next: null, seq: 0, loaded: false });
    }
    return this.states.get(key);
  }
  save(chapter) {
    const { tab, scope, q, kind, visual } = this.state(chapter);
    try { sessionStorage.setItem('kinema.book.chapter.' + chapter, JSON.stringify({ tab, scope, q, kind, visual })); } catch { }
  }
  tabs(c) {
    if (c.math) return '';
    const selected = this.state(c.n).tab;
    return `<nav class="pp-workspace-tabs" aria-label="Chapter workspace"><button type="button" data-book="tab" data-chapter="${c.n}" data-tab="lessons" aria-current="${selected === 'lessons' ? 'page' : 'false'}">Lessons</button><button type="button" data-book="tab" data-chapter="${c.n}" data-tab="problems" aria-current="${selected === 'problems' ? 'page' : 'false'}">Problems & exercises</button></nav>`;
  }
  browser(c) {
    const s = this.state(c.n), scopes = c.n === 'library' ? [['all','All chapters'], ...Array.from({length:14}, (_,i) => [String(i+1),`Chapter ${i+1}`])] : [[String(c.n),`Chapter ${c.n}`],['all','All chapters']];
    return `<section class="book-browser" data-book-browser data-chapter="${c.n}" aria-label="Problems and exercises"><div class="book-search"><input type="search" data-book-search value="${esc(s.q)}" placeholder="Find a number or title" aria-label="Search questions"><select data-book-scope aria-label="Filter by chapter">${scopes.map(([value,label]) => `<option value="${value}"${s.scope === value ? ' selected' : ''}>${label}</option>`).join('')}</select>${c.n==='library'?`<select data-book-kind aria-label="Question type">${[['','All questions'],['problem','Problems'],['exercise','Exercises']].map(([value,label])=>`<option value="${value}"${s.kind===value?' selected':''}>${label}</option>`).join('')}</select>`:''}</div><div class="book-filter" aria-label="Question type"${c.n==='library'?' hidden':''}>${[['','All'],['problem','Problems'],['exercise','Exercises']].map(([value,label]) => `<button type="button" data-book="kind" data-kind="${value}" aria-pressed="${s.kind === value}">${label}</button>`).join('')}</div><div class="book-results"></div></section>`;
  }
  mountChapter() {
    this.mount(this.t.el.pathpage.querySelector('[data-book-browser]'));
  }
  mountLibrary(host) {
    host.innerHTML = this.browser({ n: 'library' }); this.mount(host.querySelector('[data-book-browser]'));
  }
  mount(root) {
    if (!root) return;
    const s = this.state(root.dataset.chapter); this.paint(root);
    if (!s.loaded) this.load(root, true);
  }
  paint(root) {
    if (!root?.isConnected) return;
    const s = this.state(root.dataset.chapter), box = root.querySelector('.book-results');
    root.querySelectorAll('[data-book=kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === s.kind)));
    box.innerHTML = `<p class="book-count" role="status">${s.busy && !s.rows.length ? 'Loading questions…' : s.loaded ? `${s.total} ${s.total === 1 ? 'question' : 'questions'}${s.scope === 'all' ? ' across all chapters' : ' in chapter ' + s.scope}` : ''}</p>
      ${s.error ? `<p class="book-error" role="alert">${esc(s.error)} <button type="button" data-book="retry">Try again</button></p>` : ''}
      <ol class="book-list">${s.rows.map(r => `<li><button type="button" data-book="open" data-id="${esc(r.id)}" aria-label="Open ${r.kind === 'exercise' ? 'exercise' : 'problem'} ${esc(r.id)} ${esc(r.title)}"><b>${esc(r.id)}</b><span>${esc(r.title)}</span><small>${r.visual_available?'Interactive setup':r.kind === 'exercise' ? 'Exercise' : 'Problem'}</small><i aria-hidden="true">↗</i></button></li>`).join('')}</ol>
      ${s.loaded && !s.rows.length && !s.error ? `<p class="book-no-results">${s.unavailable ? 'This install has no private textbook question pack. Start a new chat and upload a problem of your own.' : 'No questions match. Try a problem number or a shorter title.'}</p>` : ''}
      ${s.next != null ? `<button type="button" class="book-more" data-book="more"${s.busy ? ' disabled' : ''}>${s.busy ? 'Loading…' : 'Show more questions'}</button>` : ''}`;
    math(box);
    const page = root.dataset.chapter === 'library' ? 'library' : 'path';
    const restore = this.t.page === page && root.getClientRects().length ? this.returnScroll : null;
    if (restore && s.error) return; // A failed page waits for the visible retry button.
    if (s.loaded && !s.busy && restore?.chapter === root.dataset.chapter && restore.id && !s.rows.some(r => r.id === restore.id) && s.next != null) { this.load(root); return; }
    if (s.loaded && !s.busy && restore?.chapter === root.dataset.chapter) requestAnimationFrame(() => {
      if (this.returnScroll !== restore || this.t.page !== page || !root.isConnected || !root.getClientRects().length) return;
      this.t.el.page.scrollTop = Math.max(0, Number(restore.top) || 0); this.returnScroll = null;
    });
  }
  async load(root, reset = false) {
    if (!root?.isConnected) return;
    const s = this.state(root.dataset.chapter), seq = ++s.seq;
    if (reset) { s.rows = []; s.next = null; s.loaded = false; }
    s.busy = true; s.error = ''; this.paint(root);
    const params = new URLSearchParams({ q: s.q, offset: reset ? 0 : s.next || 0, limit: 60 });
    if (s.scope !== 'all') params.set('chapter', s.scope); if (s.kind) params.set('kind', s.kind);
    try {
      const data = await this.t.d.api(this.t.d.url('/api/book/catalog?' + params));
      if (seq !== s.seq) return;
      s.rows = reset ? data.items : [...s.rows, ...data.items]; s.total = data.total; s.next = data.next_offset; s.loaded = true; s.unavailable = data.book?.available === false;
    } catch (e) { if (seq === s.seq) s.error = 'Could not load these questions: ' + e.message; }
    finally { if (seq === s.seq) { s.busy = false; this.paint(root); } }
  }
  async open(id, browser = null, from = null) {
    if (this.t.creating || this.t.busy) return;
    browser ||= this.t.page === 'path' ? this.t.el.pathpage.querySelector('[data-book-browser]') : this.t.page === 'library' ? this.t.host.querySelector('#libcatalog [data-book-browser]') : null;
    const state = browser && this.state(browser.dataset.chapter);
    const origin = from || (browser ? { chapter: browser.dataset.chapter, scroll: this.t.el.page.scrollTop, id, q: state.q, scope: state.scope, kind: state.kind } : this.origin());
    this.t.closeDrawer();
    return this.t.workspace.open({ book_problem_id: id }, origin);
  }

  origin() {
    try { const value = JSON.parse(sessionStorage.getItem('kinema.book.return.' + this.t.thread?.id)); if (value?.chapter === 'folder' && /^f[a-f0-9]{16}$/.test(value.folder_id) || value?.chapter === 'library' || /^(?:[1-9]|1[0-4])$/.test(value?.chapter)) return value; } catch { }
    return null;
  }
  backLabel(p) { const chapter = this.origin()?.chapter || p?.chapter; return chapter === 'folder' ? 'Back to folder' : chapter === 'library' ? 'Back to Library' : `Chapter ${chapter} questions`; }
  returnHTML(p) {
    return p ? `<button type="button" class="tv-book-back" data-book="back">${controlIcon('left')}<span>${esc(this.backLabel(p))}</span></button>` : '';
  }
  setBackLabel() {
    this.t.host.querySelectorAll('[data-book="back"] span').forEach(span => { span.textContent = this.backLabel(this.t.thread?.book_problem); });
  }
  statementHTML(src) {
    const template = document.createElement('template');
    template.innerHTML = mdlite(src).replace(/<p>---<\/p>/g, '<hr>');
    const output = document.createElement('div'); let group = output;
    for (const node of [...template.content.childNodes]) {
      if (node.nodeType !== 1) { group.append(node); continue; }
      // Move existing source text into reading groups; never paraphrase the question.
      if (node.tagName === 'P' && /^\([a-z]\)\s/.test(node.textContent)) {
        group = document.createElement('section'); group.className = 'tv-book-part'; output.append(group);
        const first = node.firstChild;
        if (first?.nodeType === 3) {
          const label = document.createElement('span'); label.className = 'tv-book-part-label'; label.textContent = first.textContent.slice(0, 3);
          first.textContent = first.textContent.slice(3); node.prepend(label);
        }
      } else if (node.tagName === 'HR') group = output;
      group.append(node);
      if (node.tagName !== 'P') continue;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let text;
      while ((text = walker.nextNode())) {
        // A printed Note is an assumption, visually separate from what is being asked.
        const match = [...text.textContent.matchAll(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|(\bNote:)/g)].find(m => m[1]); if (!match) continue;
        const range = document.createRange(); range.setStart(text, match.index); range.setEnd(node, node.childNodes.length);
        const note = document.createElement('aside'); note.className = 'tv-book-assumption';
        const para = document.createElement('p'); para.append(range.extractContents()); note.append(para); node.after(note); break;
      }
    }
    return output.innerHTML;
  }
  image(image, kind, i) {
    return `<figure class="tv-book-media"><button type="button" class="tv-book-image" data-book="image" data-kind="${kind}" data-index="${i}" aria-label="Expand ${esc(image.label || 'diagram')}">${this.imageElement(image)}</button>${this.imageFailure()}</figure>`;
  }
  imageElement(image) {
    const url = esc(this.t.d.url(image.url));
    return `<img data-book-image data-image-url="${url}" loading="lazy" src="${url}" alt="${esc(image.label || 'Problem diagram')}">`;
  }
  imageFailure() {
    return '<div class="tv-book-image-failed" role="status" hidden><span>The diagram could not load.</span><button type="button" data-book="image-retry">Try again</button></div>';
  }
  imageStatus(img, loaded) {
    const media = img.closest('.tv-book-media'); if (!media) return;
    img.hidden = !loaded;
    const opener = media.querySelector('.tv-book-image'); if (opener) opener.hidden = !loaded;
    const fallback = media.querySelector('.tv-book-image-failed'); if (fallback) fallback.hidden = loaded;
    const retry = media.querySelector('[data-book="image-retry"]');
    if (retry) { retry.disabled = false; retry.textContent = 'Try again'; }
  }
  questionHTML(p, {figures:showFigures=true}={}) {
    if (!p) return '';
    const checked = p.display_statement_md || (p.statement_status === 'checked' && p.statement_md), figures = p.images?.figure || [], setup = p.images?.setup || [], question = p.images?.question || [];
    return `<section class="tv-book-question" data-mid="book-question:${esc(p.id)}" data-book-problem="${esc(p.id)}" aria-label="${p.kind === 'exercise' ? 'Exercise' : 'Problem'} ${esc(p.id)}"><div class="tv-book-reading"><header><div><span class="tv-book-kicker">${p.kind === 'exercise' ? 'Exercise' : 'Problem'} ${esc(p.id)}</span><h2>${esc(p.title)}</h2></div><button type="button" class="tv-book-folder" title="Add to folder" data-folder-action="add" data-folder-kind="book" data-folder-id="${esc(p.id)}" data-folder-title="${esc(p.title)}" aria-label="Add ${p.kind === 'exercise' ? 'exercise' : 'problem'} ${esc(p.id)} to a folder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3zM12 10v7m-3-3.5h6"/></svg></button></header>
      ${checked ? `<div class="tv-book-statement mdb">${this.statementHTML(p.display_statement_md || p.statement_md)}</div>` : `<p class="tv-book-fallback">Question</p><div class="tv-book-scans">${question.map((r,i) => this.image(r,'question',i)).join('') || '<p>The question is unavailable. Please reopen it from the Library.</p>'}</div>`}
      ${showFigures && (figures.length || setup.length) ? `<div class="tv-book-figures">${setup.map((r,i) => this.image(r,'setup',i)).join('')}${figures.map((r,i) => this.image(r,'figure',i)).join('')}</div>` : ''}
      </div></section>`;
  }
  sceneHTML(p) { return p?.visual ? `<section class="tv-book-simulation" data-mid="book-scene:${esc(p.id)}" aria-label="Prepared problem simulation"><h3>Explore the setup</h3><div data-book-scene></div></section>` : ''; }
  parkScene() { if (this.sceneHost) (this.parking ||= document.createDocumentFragment()).append(this.sceneHost); }
  rememberVisual() { if(this.viewer&&this.sceneKey){const state=this.viewer.state;this.savedViews.set(this.sceneKey,state);try{localStorage.setItem('kinema.reader.visual.'+this.sceneKey,JSON.stringify(state))}catch{}} }
  leave() {
    ++this.sceneSeq;
    this.rememberVisual();
    this.viewer?.destroy(); this.viewer = null; this.sceneHost?.remove(); this.sceneHost = null; this.sceneKey = null;
  }
  visualState() { return this.viewer && !this.t.page && !this.t.studyShown ? this.viewer.state : null; }
  async syncScene() {
    const p = this.t.thread?.book_problem;
    this.paintHelp(p);
    if (!p?.visual || !this.t.active || this.t.page || this.t.studyShown) { if (this.sceneHost) this.leave(); return; }
    const slot = this.t.host.querySelector('.lr-visual [data-book-scene]') || this.t.el.stream.querySelector('[data-book-scene]');
    if (!slot || !slot.getClientRects().length) { if (this.sceneHost) this.leave(); return; }
    const key = 'book:' + p.id + ':' + (p.source_revision || '');
    if (this.sceneKey === key && this.sceneHost) { if(this.sceneHost.parentElement!==slot)slot.append(this.sceneHost);this.syncFocus(); return; }
    this.leave(); this.sceneKey = key;
    const seq = ++this.sceneSeq, host = document.createElement('div'); host.className = 'tv-book-scene';
    host.innerHTML = '<p class="tv-book-scene-loading" role="status">Opening the prepared setup…</p>'; slot.append(host); this.sceneHost = host;
    try {
      const experiment = p.visual.kind === 'chapter_experiment';
      const module = await import(experiment ? './chapter_experiments.js' : './daily_visuals.js');
      if (seq !== this.sceneSeq || !host.isConnected) return;
      const viewer = experiment ? await module.mountChapterExperiment(host, p.visual, {problem:p,teacher:this.t,live:()=>seq===this.sceneSeq&&host.isConnected&&this.t.thread?.book_problem?.id===p.id,onHelpReveal:()=>this.helpReveal(p)}) : await module.mountDailyVisual(host, p.visual, { compact: false, embedded:true, intent:'practice', allowAnswerBreakdown:true, onHelpReveal:()=>this.helpReveal(p) });
      if (seq !== this.sceneSeq || !host.isConnected) { viewer.destroy(); return; }
      this.viewer = viewer; host.querySelector('.tv-book-scene-loading')?.remove();
      let saved=this.savedViews.get(key);if(!saved)try{saved=JSON.parse(localStorage.getItem('kinema.reader.visual.'+key))}catch{}
      const local = !this.t.thread?.reading&&this.t.companion?.solutionMessageId?.() ? undefined : this.t.workspace?.preparedFocusTarget?.();
      if (saved) { if(experiment&&viewer.restore)viewer.restore(saved);else{viewer.setView(saved.view); viewer.setTime(saved.t);if(local===undefined&&saved.forces===true)viewer.setForces?.(true,{silent:true});} }
      viewer.resize();
      if (local===undefined&&saved?.focus?.focus_state_id) viewer.focus?.(saved.focus.focus_state_id, { step_id: saved.focus.step_id, ms: 0 });
      // New viewer, including a delayed mount or reopening: use the current local
      // reveal, not a binding applied to a destroyed viewer earlier in the visit.
      this.focusApplied.delete(key);
      this.syncFocus();
    } catch (e) { if (seq === this.sceneSeq) host.innerHTML = `<p class="tv-book-scene-loading">The prepared setup could not open. <button type="button" data-book="scene-retry">Try again</button></p>`; }
  }
  helpKey(p) { return 'kinema.book.force-save.'+p.id+':'+p.source_revision; }
  helpReceipt(p) {
    if(!p)return null;
    const key=this.helpKey(p);this.helpReceipts ||= new Map();
    if(!this.helpReceipts.has(key))try{
      const r=JSON.parse(localStorage.getItem(key));
      if(r?.problem?.id===p.id&&r.problem.source_revision===p.source_revision)this.helpReceipts.set(key,r);
    }catch{}
    return this.helpReceipts.get(key)||null;
  }
  keepHelp(r) {
    const key=this.helpKey(r.problem);(this.helpReceipts ||= new Map()).set(key,r);
    try{localStorage.setItem(key,JSON.stringify(r))}catch{}
  }
  paintHelp(p) {
    if(!p||this.t.thread?.book_problem?.id!==p.id||this.t.thread.book_problem.source_revision!==p.source_revision)return;
    const note=this.t.host.querySelector('.lr-visual-note');if(!note)return;
    if(p.visual?.kind==='chapter_experiment'){note.hidden=true;return;}
    const r=this.helpReceipt(p),busy=this.helpSaving?.has(this.helpKey(p));
    let assisted=false;try{assisted=localStorage.getItem('kinema.book.assisted.'+p.id+':'+p.source_revision)==='1'}catch{}
    const messages={ready:'Source-matched setup. Reveal forces when you want help.',saved:'Visual help revealed - assisted view',
      saving:'Visual help revealed - assisted view. Saving exposure…',mapping:'Visual help revealed - assisted view. Skill coverage could not be loaded.',
      save:'Visual help revealed - assisted view. Exposure could not be saved.',interrupted:'Visual help revealed - assisted view. Exposure save was interrupted.'};
    const state=!r?(assisted?'saved':'ready'):busy?'saving':r.error==='mapping'?'mapping':r.error==='save'?'save':'interrupted';
    const retry=s=>['mapping','save','interrupted'].includes(s);
    // All variants measure together at the current width/font. Changing save state
    // cannot resize the canvas and cause its ResizeObserver to refit the camera.
    // CSS-generated measuring text is aria-hidden and absent from textContent/live regions.
    const measures=Object.entries(messages).map(([s,text])=>`<span class="book-help-measure" aria-hidden="true" data-help-text="${esc(text)}">${retry(s)?'<span class="book-help-action-space"></span>':''}</span>`).join('');
    note.classList.add('book-help-note');note.dataset.helpState=state;
    note.innerHTML=measures+`<span class="book-help-current"><span${retry(state)?' role="alert"':state==='saving'?' role="status"':''}>${messages[state]}</span>${retry(state)?`<button type="button" data-book="help-retry" data-id="${esc(p.id)}" data-revision="${esc(p.source_revision)}">Retry save</button>`:''}</span>`;
  }
  helpReveal(p) {
    // Persist the original binding before any network request. Reopen/reload never
    // sends it automatically; only another explicit reveal or Retry save can do so.
    try{localStorage.setItem('kinema.book.assisted.'+p.id+':'+p.source_revision,'1')}catch{}
    const r=this.helpReceipt(p)||{problem:{id:p.id,chapter:p.chapter,section_id:p.section_id,source_revision:p.source_revision},items:null};
    this.keepHelp(r);return this.saveHelp(r);
  }
  saveHelp(r) {
    const p=r.problem,key=this.helpKey(p);this.helpSaving ||= new Map();
    if(this.helpSaving.has(key))return this.helpSaving.get(key);
    const task=Promise.resolve().then(async()=>{
      r.error='';this.keepHelp(r);
      try{
        if(!Array.isArray(r.items)){
          const sectionOf=chapters=>(Array.isArray(chapters)?chapters:[]).find(c=>c.n===p.chapter)?.groups?.flatMap(g=>g.sections||[]).find(s=>s.id===p.section_id);
          let section=sectionOf(this.t.chMap);
          if(!Array.isArray(section?.skills))section=sectionOf((await this.t.d.api(this.t.d.url('/api/chapter-map'))).chapters);
          if(!Array.isArray(section?.skills))throw Error('Missing skill coverage');
          r.items=section.skills.map(s=>({skill:s.id,kind:'taught',outcome:'exposure',source:'coach',ref:'book:'+p.id+':forces',dedup:'book-forces:'+p.id+':'+p.source_revision+':'+s.id,note:'Revealed prepared visual help while practicing; assisted exposure, no independent answer.'}));
          this.keepHelp(r);
        }
        if(r.items.length){
          const result=await this.t.post('/api/evidence',{items:r.items});
          if(result?.results?.length!==r.items.length||result.results.some(s=>s.error||!(s.recorded||s.duplicate)))throw Error('Exposure unavailable');
        }
        this.helpReceipts.delete(key);try{localStorage.removeItem(key)}catch{}
      }catch{r.error=Array.isArray(r.items)?'save':'mapping';this.keepHelp(r)}
    }).finally(()=>{this.helpSaving.delete(key);this.paintHelp(p)});
    this.helpSaving.set(key,task);this.paintHelp(p);return task;
  }
  /* Step-synced close-ups: the displayed solution step's saved binding {step_id, scene_id, scene_revision,
     focus_state_id} is applied once; a binding for another scene or revision, or an unknown id, changes nothing.
     The displayed step is the companion's open Solution step, else the newest revealed step. */
  focusTarget(detail) {
    const steps = this.t.thread?.book_solution?.steps || [];
    if (detail && typeof detail.focus_state_id === 'string') return { step_id: detail.step_id || '', focus_state_id: detail.focus_state_id, scene_id: detail.scene_id, scene_revision: detail.scene_revision };
    // A fresh reading visit has closed help even when a saved conversation's
    // companion preference still names its old Solution tab.
    const mid = this.t.thread?.reading ? undefined : this.t.companion?.solutionMessageId?.();
    if (!mid) {
      const local=this.t.workspace?.preparedFocusTarget?.();
      if(local!==undefined)return local;
    }
    const step = (mid && steps.find(s => s.message_id === mid)) || (mid ? null : steps[steps.length - 1]);
    return step?.focus || null;
  }
  syncFocus(detail) {
    if(this.t.active===false||this.t.page||this.t.studyShown||this.t.workspace?.view?.().visualOpen===false)return;
    if(this.sceneHost?.getClientRects?.().length===0)return;
    const v = this.viewer, b = this.focusTarget(detail), info = v?.focusInfo?.();
    if (!v || !b || !info || b.scene_id !== info.scene_id || b.scene_revision !== info.scene_revision) return;
    if(!info.states?.some(s=>s.id===b.focus_state_id)||!b.step_id)return;
    const id = `${b.step_id}:${b.focus_state_id}`, key = this.sceneKey;
    if (this.focusApplied.get(key) === id) return;
    this.focusApplied.set(key, id);
    // A local force explanation is explicit assisted help. Use the existing
    // reveal callback/receipt path, without changing tutor-message semantics.
    if(b===this.t.workspace?.preparedFocusTarget?.()&&b.scene_id==='9.13'&&b.focus_state_id==='ring_forces')v.setForces?.(true,{explicit:true});
    // a late acknowledgement from a replaced viewer is ignored: applyFocus resolves false once superseded or destroyed
    v.applyFocus(b);
  }
  click(b, e) {
    e.preventDefault(); const action = b.dataset.book, root = b.closest('[data-book-browser]');
    if (action === 'tab') { this.state(b.dataset.chapter).tab = b.dataset.tab; this.save(b.dataset.chapter); return this.t.renderPathPage(); }
    if (action === 'kind') { this.returnScroll = null; this.state(root.dataset.chapter).kind = b.dataset.kind; this.save(root.dataset.chapter); return this.load(root, true); }
    if (action === 'more' || action === 'retry') return this.load(root, action === 'retry');
    if (action === 'open') return this.open(b.dataset.id, root);
    if (action === 'help-retry') {
      const p=this.t.thread?.book_problem;
      if(p?.id!==b.dataset.id||p.source_revision!==b.dataset.revision)return;
      const r=this.helpReceipt(p);if(r)return this.saveHelp(r);return;
    }
    if (action === 'image-retry') {
      const img = b.closest('.tv-book-media')?.querySelector('img[data-book-image]'); if (!img) return;
      b.disabled = true; b.textContent = 'Retrying…';
      const url = new URL(img.dataset.imageUrl, location.href); url.searchParams.set('retry', Date.now());
      img.src = url.href; return;
    }
    const p = this.t.thread?.book_problem; if (!p) return;
    if (action === 'scene-retry') { this.leave(); return this.syncScene(); }
    if (action === 'back' && this.t.workspace.manages()) return this.t.workspace.back();
    if (action === 'back') {
      const origin = this.origin(); if (origin?.chapter === 'folder') return this.t.libraryFolders.openReturn(origin);
      const chapter = origin?.chapter || p.chapter, state = this.state(chapter); state.tab = 'problems';
      if (origin && typeof origin.q === 'string' && ['','problem','exercise'].includes(origin.kind) && (origin.scope === 'all' || (chapter === 'library' ? /^(?:[1-9]|1[0-4])$/.test(origin.scope) : origin.scope === String(chapter)))) {
        if (state.q !== origin.q || state.kind !== origin.kind || state.scope !== origin.scope) { state.rows = []; state.loaded = false; state.next = null; ++state.seq; }
        Object.assign(state, { q: origin.q, kind: origin.kind, scope: origin.scope });
      }
      this.save(chapter); this.returnScroll = origin ? { chapter: String(chapter), top: origin.scroll, id: origin.id } : null;
      if (chapter === 'library') this.t.d.openBookLibrary();
      else { this.t.ppOpen = String(chapter); this.t.openPage('path'); }
      return;
    }
    if (action === 'image') {
      const r = p.images?.[b.dataset.kind]?.[Number(b.dataset.index)]; if (!r) return;
      const name=`${p.kind==='exercise'?'Exercise':'Problem'} ${p.id} · diagram`;
      const source=image=>{const url=new URL(this.t.d.url(image.url),location.href);url.searchParams.set('detail','true');return url.href};
      const images=['setup','figure','question'].flatMap(kind=>(p.images?.[kind]||[]).map(image=>({url:source(image),name:image.label||name})));
      window.KinemaImageViewer.open(source(r),name,{images,returnFocus:()=>this.t.host.querySelector(`[data-book="image"][data-kind="${b.dataset.kind}"][data-index="${b.dataset.index}"]`)});
    }
  }
}
