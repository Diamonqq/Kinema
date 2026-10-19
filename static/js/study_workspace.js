import { controlIcon } from './icons.js';
import { bindVisualResize } from './viewer_controls.js';
import { esc, mdlite, math, texExpr } from './md.js';
import { lessonReader, lessonNavigation } from './lesson_reader.js';
import { ReaderVisual } from './reader_visual.js';
import { ProblemGuidance, validatedGuidance } from './problem_guidance.js';
import { ReadingHistory } from './reading_history.js';
import { LessonSplitter } from './lesson_splitter.js';

const visualSizeIcon = restore => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(restore?'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6':'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6')+'"/></svg>';
const read = key => { try { return JSON.parse(localStorage.getItem('kinema.reading.' + key)); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem('kinema.reading.' + key, JSON.stringify(value)); } catch { } };

// Shared by status changes and scrolling, so loading/failed reading cannot retain chat chrome.
export function studyChrome(thread, { loading = false, nearBottom = true } = {}) {
  const hasUser = !!thread?.messages?.some(m => m.role === 'user');
  const starters = !!thread && !loading && !thread.pending && !hasUser && !thread.topic_companion && !thread.book_problem;
  return { starters, jump: !!thread && !thread.reading && !loading && hasUser && !nearBottom };
}

// Reading has a local identity. A saved conversation is acquired only by explicit Send.
export class StudyWorkspace {
  constructor(t) {
    this.t = t; this.seq = 0; this.beginVisit(); this.visual = new ReaderVisual(t); this.history = new ReadingHistory(t);
    if (t.el.main?.insertAdjacentHTML) {
      t.el.main.insertAdjacentHTML('afterend', `<div class="lr-shell" aria-label="Lesson artifact" hidden><nav class="lr-bar" aria-label="Reading workspace"><button data-reading="back">Back to chapter</button><div class="lr-order-slot"></div><span class="lr-mobile-surfaces"><button data-reading="surface" data-surface="reading">Lesson</button><button data-reading="surface" data-surface="visual">Setup</button></span><button data-reading="visual-open" class="lr-bar-visual" hidden>Show diagram</button></nav><section class="lr-read" aria-label="Reading"></section><aside class="lr-visual" aria-label="Relevant visual"><div class="lr-visual-bar"><h2></h2><button data-reading="visual-expand" aria-label="Expand visual" title="Expand visual">${visualSizeIcon(false)}</button><button data-reading="visual-close" aria-label="Close visual">&times;</button></div><div class="lr-visual-slot tv-inline-visual"></div><p class="lr-visual-note"></p></aside></div>`);
      this.el={shell:t.host.querySelector('.lr-shell'),read:t.host.querySelector('.lr-read'),aside:t.host.querySelector('.lr-visual'),slot:t.host.querySelector('.lr-visual-slot')};
      t.el.scroll.insertBefore(this.el.aside,t.el.stream);
      this.guidance=new ProblemGuidance(t,{onToggle:open=>this.setGuidance(open),onHelp:action=>this.requestHelp(action)});
      this.splitter=new LessonSplitter(t.host,this.el.shell);
      this.el.read.addEventListener('scroll',()=>this.readerScroll.set(this.key(t.thread),this.el.read.scrollTop),{passive:true});
      t.host.addEventListener('change',e=>{if(e.target.matches('[data-reader-section]'))this.pick(e.target.value);if(e.target.matches('[data-reader-example]')){this.view().example=Number(e.target.value);this.saveView();this.paintLesson(t.thread.topic_companion);this.visual.setExample(this.view().example)}});
      window.addEventListener('keydown',e=>{if(!this.expanded){if(this.active()&&e.key==='Escape'&&this.el.aside.contains(document.activeElement)){e.preventDefault();e.stopImmediatePropagation();this.view().visualOpen=false;this.saveView();this.sync();this.el.aside.querySelector('.lr-reopen')?.focus()}return;}if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.expand(false)}else if(e.key==='Tab'){const nodes=[...this.el.aside.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>n.getClientRects().length&&!n.disabled);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||!nodes.includes(document.activeElement))){e.preventDefault();last?.focus()}else if(!e.shiftKey&&(document.activeElement===last||!nodes.includes(document.activeElement))){e.preventDefault();first?.focus()}}},true);
    }
    t.host.addEventListener('click', e => {
      const b = e.target.closest('[data-reading]'); if (!b) return;
      const action = b.dataset.reading;
      if(action==='lesson-move'){const dest=this.selected()?.navigation?.[b.dataset.direction];if(dest){this.remember();return this.open({study_context:dest.study_context},{chapter:dest.study_context.chapter,scroll:0},{target:dest.id});}return}
      if(action==='example'){this.view().example=Number(b.dataset.index);this.saveView();this.paintLesson(t.thread.topic_companion);this.visual.setExample(this.view().example);return}
      if(action==='surface'){this.surface=b.dataset.surface;this.sync();requestAnimationFrame(()=>{this.t.stage?.refit?.();this.t.book?.viewer?.resize?.()});return}
      if(action==='visual-close'){this.view().visualOpen=false;this.saveView();this.expand(false);this.sync();return}
      if(action==='visual-open'){this.view().visualOpen=true;this.surface='visual';this.saveView();this.sync();return}
      if(action==='visual-expand')return this.expand(!this.expanded);
      if(action==='visual-retry'){this.visual.leave();this.t.book?.leave();this.sync();return}
      if(action==='lesson-tab'){this.readerScroll.set(this.key(t.thread),0);this.view().tab=b.dataset.tab;this.saveView();this.paintLesson(t.thread.topic_companion);return}
      if(action==='practice-hint'||action==='practice-answer'){if(action==='practice-hint'){if(this.view().answer)return;this.view().hints=(this.view().hints||0)+1;}else this.view().answer=true;this.saveView();this.paintLesson(t.thread.topic_companion);return} 
      if (action === 'back') return this.back();
      if (action === 'retry') return this.open(this.scope, this.origin);
      if (action === 'hint' || action === 'step') {
        this.reveal(action); return;
      }
      if (action === 'lesson-pick') return this.pick(b.dataset.section);
    });
  }
  // Only navigation starts a visit. Renders, replies and local-to-saved thread adoption do not.
  beginVisit(){this.section=null;this.viewKey=null;this.readerSig=null;this.readerViews=new Map();this.readerScroll=new Map();this.helpViews=new Map();}
  key(t) { return t?.book_problem ? 'book:' + t.book_problem.id : t?.study_context ? JSON.stringify(t.study_context) : 'new'; }
  manages(t = this.t.thread) { return !!(t?.study_context || t?.book_problem || t?.topic_companion); }
  async open(scope, origin = null, {resume=false,target=null,tab=null} = {}) {
    this.history.set(null);
    const t = this.t, seq = ++this.seq;
    t.saveDraft(); t.saveScroll(); t.book.leave(); t.mic?.cancel(true);
    this.beginVisit();
    this.section = null; this.viewKey=null; this.readError=null;this.loading=true;this.opening=true;this.surface='reading';this.readerSig=null;this.visual.leave();
    this.scope = scope; this.origin = origin || { chapter: scope.study_context?.chapter || scope.book_problem_id?.split('.')[0], scroll: t.el.page.scrollTop };
    save('current', { scope, origin: this.origin });
    t.leaveViews(); const epoch = t.navigationEpoch;
    t.threadLoading = 'reading'; t.renderStatus();
    t.el.stream.innerHTML = '<p class="sw-loading" role="status">Opening your reading…</p>';
    try {
      const params = new URLSearchParams(scope.book_problem_id ? { book_problem_id: scope.book_problem_id } : { scope: JSON.stringify(scope.study_context) });
      const r = await t.d.api(t.d.url('/api/teacher/reading?' + params));
      if (seq !== this.seq || epoch !== t.navigationEpoch) return;
      const originKey = r.book_problem ? 'book:' + r.book_problem.id : JSON.stringify(r.study_context);
      save('origin.' + originKey, this.origin);
      if (r.thread_id) {
        t.threadLoading = null; await t.openThread(r.thread_id,false,{reading:true});
        if (seq !== this.seq || epoch !== t.navigationEpoch) return;
      } else {
        const key = r.scope_key;
        t.threadLoading = null;
        t.courseId = '2301';
        t.setThread({ id: 'reading:' + key, reading: true, course_id: '2301', messages: [], revision: 0,
          title: r.book_problem?.title || r.study_context?.label, ...r }, { restore: true });
      }
      if(target){this.section=target;this.readerScroll.set(this.key(t.thread),0);this.view().tab=tab||'explanation';this.saveView();this.readerSig=null;}else if(tab){this.view().tab=tab;this.saveView();this.readerSig=null;}
      t.el.scroll.scrollTop = read('scroll.' + this.key(t.thread)) || 0;
    } catch (e) {
      if (seq !== this.seq || epoch !== t.navigationEpoch) return;
      t.threadLoading = null;
      t.thread = null; t.el.input.value = ''; t.pendingFiles = []; t.renderFiles();
      this.readError=e.message;this.readerSig=null;
      t.host.classList.remove('sw-active');
      t.setCrumb();
      t.el.stream.innerHTML = '';
      t.el.input.disabled = true;
    } finally { if (seq === this.seq) {this.loading=false;this.opening=false;t.threadLoading = null;this.sync();t.renderStatus();t.syncSend();if(!resume&&!this.readError){requestAnimationFrame(()=>{if(seq!==this.seq)return;if(t.thread?.messages?.length)t.toBottom(true);else t.el.scroll.scrollTop=0;});}} }
  }
  cancel() { this.history.set(null); ++this.seq;this.loading=false;this.readError=null;this.opening=false;this.visual.leave();this.expand(false);save('current', null); }
  accept(t, changed) {
    if (changed) {this.readerSig=null;this.origin=read('origin.'+this.key(t));}
    if(!this.manages(t)){this.history.set(null);this.visual.leave();this.expand(false)}
  }
  remember() { if (this.manages()) {save('scroll.' + this.key(this.t.thread), this.t.el.scroll.scrollTop);if(this.el)this.readerScroll.set(this.key(this.t.thread),this.el.read.scrollTop);this.visual.remember();this.t.book?.rememberVisual?.();} }
  position() { return read('scroll.' + this.key(this.t.thread)) || 0; }
  restore() { return read('current'); }
  async ensureConversation() {
    const t = this.t;
    if (!t.thread?.reading) return true;
    const local = t.thread, epoch = t.navigationEpoch, text = t.el.input.value, files = t.pendingFiles, stepReference=t.stepReference;
    const scope = local.book_problem ? { book_problem_id: local.book_problem.id } : local.study_context ? { study_context: local.study_context } : {};
    t.saveDraft(); t.creating = true; t.renderStatus();
    try {
      const createKey = 'create.' + local.id, request = read(createKey) || 'reading-' + crypto.randomUUID(); save(createKey, request);
      const actual = await t.post('/api/teacher/threads', { course_id: t.courseId, fresh: true,
        request_id: request, ...(Object.keys(scope).length ? { mode: 'scoped', ...scope } : {}) });
      save(createKey, null);
      t.upsertSummary(actual);
      if (t.thread !== local || epoch !== t.navigationEpoch) return false;
      t.setThread(actual); t.stepReference=stepReference;t.refs?.render();t.el.input.value = text; t.pendingFiles = files; t.renderFiles(); t.fit(); t.saveDraft();
      if (this.origin && actual.book_problem) try { sessionStorage.setItem('kinema.book.return.' + actual.id, JSON.stringify(this.origin)); } catch { }
      return true;
    } catch (e) { if (t.thread === local) t.note('Not sent: ' + e.message + ' Your draft is still here.'); return false; }
    finally { t.creating = false; t.renderStatus(); t.syncSend(); }
  }
  back() {
    const t = this.t, p = t.thread?.book_problem, origin = read('origin.' + this.key(t.thread)) || this.origin;
    this.remember(); t.saveDraft(); this.cancel();
    if (origin?.chapter === 'folder') return t.libraryFolders.openReturn(origin);
    if (origin?.chapter === 'library') {t.book.returnScroll={chapter:'library',top:origin.scroll,id:origin.id};return t.d.openBookLibrary();}
    const chapter = origin?.chapter || t.thread?.study_context?.chapter || p?.chapter;
    if (p) {
      t.book.state(chapter).tab = 'problems';
      t.book.returnScroll = origin ? { chapter: String(chapter), top: origin.scroll, id: origin.id } : null;
    }
    t.ppOpen = String(chapter); t.openPage('path');
    requestAnimationFrame(() => { t.el.page.scrollTop = origin?.scroll || 0; });
  }
  selected(sheet = this.t.thread?.topic_companion) {
    const rows = (sheet?.sections || []).flatMap(r => [r, ...(r.subsections || [])]);
    // Section choice belongs to this visit, never an old browser preference.
    return rows.find(r => r.id === this.section) || rows[0];
  }
  lessonHTML(sheet) { const s=this.selected(sheet);return s?lessonReader(s,sheet,this.view()):''; }
  paintLesson(sheet) {this.readerSig=null;this.sync()}
  pick(id){this.readerScroll.set(this.key(this.t.thread),0);this.section=id;this.readerSig=null;this.surface='reading';this.expand(false);this.visual.leave();this.sync()}
  view(){const key=this.key(this.t.thread)+':'+(this.t.thread?.book_problem?'problem':this.selected()?.id||'problem');if(this.viewKey!==key){this.viewKey=key;this.readerView=this.readerViews.get(key)||{tab:'explanation',example:0,hints:0,answer:false,visualOpen:true};this.readerViews.set(key,this.readerView)}return this.readerView}
  saveView(){this.readerViews.set(this.viewKey,this.readerView)}
  active(){return this.t.active!==false&&!!(this.loading||this.readError||this.manages())&&!this.t.page&&!this.t.studyShown}
  // The header pill's choice belongs to this problem's view; the transcript and composer are untouched.
  setGuidance(open){this.view().guidanceOpen=!!open;this.saveView();this.sync()}
  requestHelp(action){
    const p=this.t.thread?.book_problem;
    if(!p||!this.active()||this.loading||this.readError||this.t.busy||this.t.creating||this.t.threadLoading||this.t.thread.pending)return;
    const state=this.progress(p);
    if(action==='hint'&&p.prepared_help?.available&&!state.steps&&state.hints<(p.prepared_help.hints||[]).length)return this.reveal('hint');
    const text=action==='ideas'
      ? 'Explain the useful ideas and formulas for this exact question. Use the current source statement and checked source material, define symbols and assumptions, and omit unrelated section formulas. Start with one idea; do not solve the problem.'
      : 'Give me one small next hint for this exact question, using the current source statement and checked source material. Build on help already shown and our conversation without repeating it. Do not reveal the complete solution; ask one short question.';
    return this.t.sendHelp(text);
  }
  expand(value){this.expanded=!!value;if(this.el){for(const n of [this.el.read,this.el.shell.querySelector('.lr-bar'),this.t.el.stream,this.t.el.composer,this.t.el.main.querySelector('.tv-head')])if(n)n.inert=this.expanded;const b=this.el.aside.querySelector('[data-reading=visual-expand]');b.innerHTML=visualSizeIcon(value);b.setAttribute('aria-label',value?'Restore visual size':'Expand visual');if(value)b.focus({preventScroll:true})}this.el?.aside.classList.toggle('lr-expanded',this.expanded);this.el?.aside.setAttribute('role',value?'dialog':'complementary');if(value)this.el?.aside.setAttribute('aria-modal','true');else this.el?.aside.removeAttribute('aria-modal');requestAnimationFrame(()=>{this.t.stage?.refit?.();this.t.book?.viewer?.resize?.()})}
  sync(){
    if(!this.el)return;
    const t=this.t,on=this.active(),view=this.view();
    this.el.shell.hidden=!on;t.host.classList.toggle('lr-active',on);t.host.classList.remove('lr-tutoring');t.host.classList.toggle('lr-show-visual',this.surface==='visual');
    this.splitter?.queue();
    if(!on){this.guidance?.paint(null,false);this.el.aside.hidden=true;this.history.set(null);this.visual.leave();this.expand(false);return}
    const back=this.origin?.chapter==='library'?'Library':this.origin?.chapter==='folder'?'folder':'chapter';
    const chapter=this.origin?.chapter||t.thread?.study_context?.chapter||t.thread?.book_problem?.chapter;
    this.el.shell.querySelector('[data-reading=back]').innerHTML=controlIcon('left')+' '+esc(back==='chapter'?(chapter?'Chapter '+chapter:'Chapters'):back==='folder'?'Folder':'Library');
    for(const button of this.el.shell.querySelectorAll('[data-reading=surface]'))button.setAttribute('aria-current',button.dataset.surface===(this.surface||'reading')?'page':'false');
    const p=t.thread?.book_problem,s=!p?this.selected():null,visual=p?.visual||s?.reader_visual;
    this.guidance?.paint(this.loading||this.readError?null:p,view.guidanceOpen);
    const figures=!visual&&!!(p?.images?.setup?.length||p?.images?.figure?.length);
    const available=!!visual,show=available&&view.visualOpen!==false&&!this.loading&&!this.readError;
    t.host.classList.toggle('lr-has-visual',show);this.el.aside.hidden=!show;
    if(!show&&this.expanded)this.expand(false);
    this.el.shell.querySelector('.lr-order-slot').innerHTML=!this.loading&&!this.readError&&!p?lessonNavigation(s?.navigation):'';
    const mobile=this.el.shell.querySelector('.lr-mobile-surfaces');mobile.hidden=true;
    this.el.shell.querySelector('.lr-bar-visual').hidden=!available||show;
    if(!show){this.surface='reading';t.host.classList.remove('lr-show-visual')}
    this.history.set(!this.loading&&!this.readError&&s?.lesson?s.id:null);
    const signature=JSON.stringify([this.key(t.thread),s?.id,s?.lesson?.id,p?.source_revision,view.tab,view.example,view.hints,view.answer,this.loading,this.readError]);
    if(signature!==this.readerSig){
      this.readerSig=signature;
      if(this.loading)this.el.read.innerHTML='<p class="sw-loading" role="status">Opening your reading...</p>';
      else if(this.readError)this.el.read.innerHTML=`<div class="sw-error" role="alert"><h1>This reading could not open</h1><p>${esc(this.readError)}</p><button data-reading="retry">Try again</button></div>`;
      else this.el.read.innerHTML=p?t.book.questionHTML(p,{figures:true})+this.helpHTML(p):this.lessonHTML(t.thread.topic_companion);
      math(this.el.read);this.t.refs?.render();this.el.read.scrollTop=this.readerScroll.get(this.key(t.thread))||0;
    }
    this.el.aside.dataset.visualMin=visual?.kind==='chapter_experiment'&&!visual.native_lesson?(innerWidth<=800?'380':'480'):visual?.kind==='light_pulse'?'500':p||visual?.kind==='recipe'?'380':'300';if(show)bindVisualResize(this.el.aside,'kinema.visual-height.lesson');
    const title=this.el.aside.querySelector('h2');title.textContent=p?'Problem setup':visual?.title||'';
    this.el.aside.querySelector('[data-reading=visual-expand]').hidden=!visual||view.visualOpen===false;
    this.el.aside.querySelector('[data-reading=visual-close]').hidden=!visual||view.visualOpen===false;
    const note=this.el.aside.querySelector('.lr-visual-note');note.textContent='';note.hidden=!p;
    this.el.aside.classList.toggle('lr-closed',view.visualOpen===false);
    let reopen=this.el.aside.querySelector('.lr-reopen');if(!reopen){reopen=document.createElement('button');reopen.className='lr-reopen';reopen.dataset.reading='visual-open';reopen.textContent='Open visual';this.el.aside.insertBefore(reopen,this.el.slot)}reopen.hidden=!visual||view.visualOpen!==false;
    this.el.slot.hidden=view.visualOpen===false||this.loading||!!this.readError;
    if(this.loading||this.readError){this.visual.leave();t.book?.leave();return}
    if(p){this.visual.leave();if(p.visual){if(!this.el.slot.querySelector('[data-book-scene]'))this.el.slot.innerHTML='<div data-book-scene></div>';t.book.syncScene()}else{t.book.leave();this.el.slot.innerHTML=[...(p.images?.setup||[]).map((r,i)=>t.book.image(r,'setup',i)),...(p.images?.figure||[]).map((r,i)=>t.book.image(r,'figure',i))].join('')||'<p class="lr-unavailable">Use the question and its stated assumptions.</p>'}}
    else if(visual)this.visual.sync(s,this.el.slot,{open:show});else{this.visual.leave();this.el.slot.innerHTML=''}
  }
  helpKey(p) { return 'help.' + p.id + '.' + (p.prepared_help?.revision || p.source_revision || 'none'); }
  reveal(action) {
    const p = this.t.thread?.book_problem; if (!p?.prepared_help?.available) return;
    const state = this.progress(p), field = action === 'hint' ? 'hints' : 'steps';
    if(action==='hint'&&state.steps>0)return;
    const next = Math.min((p.prepared_help[field] || []).length, state[field] + 1);
    if (next === state[field]) return;
    state.order.push({ field, index: state[field] }); state[field] = next;
    this.helpViews.set(this.helpKey(p), state); this.repaintHelp();
    if (field === 'steps') this.t.book?.syncFocus?.();
  }
  // undefined leaves tutor/companion focus authoritative; null means local help
  // exists but is closed or its current step has no reviewed binding.
  preparedFocusTarget() {
    const p=this.t.thread?.book_problem;
    if(!this.manages()||!p?.prepared_help?.available)return undefined;
    const n=this.progress(p).steps;
    return n ? p.prepared_help.steps[n-1]?.focus || null : null;
  }
  progress(p) {
    const saved = this.helpViews.get(this.helpKey(p)) || {}, h = p.prepared_help;
    const hints = Math.min(h?.hints?.length || 0, Math.max(0, Math.floor(Number(saved.hints) || 0)));
    const steps = Math.min(h?.steps?.length || 0, Math.max(0, Math.floor(Number(saved.steps) || 0)));
    const fallback = [...Array.from({length:hints},(_,index)=>({field:'hints',index})),...Array.from({length:steps},(_,index)=>({field:'steps',index}))];
    const seen = new Set(), order = (Array.isArray(saved.order) ? saved.order : fallback).filter(r => {
      const valid = r && ['hints','steps'].includes(r.field) && Number.isInteger(r.index) && r.index >= 0 && r.index < (r.field === 'hints' ? hints : steps);
      const key = r?.field + ':' + r?.index; if (!valid || seen.has(key)) return false; seen.add(key); return true;
    });
    return { hints, steps, order };
  }
  helpHTML(p) {
    if (!p) return '';
    const h = p.prepared_help, state = this.progress(p), hints = h?.hints || [], steps = h?.steps || [];
    if (!h?.available || (!hints.length && !steps.length)) return '';
    const conceptual = h.interaction === 'conceptual';
    const revealed = state.order.map(({field,index}) => {
      const r = h[field][index], hint = field === 'hints';
      return `<section><div class="sw-step-heading">${!hint?`<button type="button" class="lr-step-number" data-reference-kind="problem" data-reference-step="${index}" aria-label="Ask about step ${index+1}" title="Attach step ${index+1} to your question">${index+1}</button>`:''}<h3>${esc(hint ? 'Hint ' + (index+1) : r.title || 'Step ' + (index+1))}</h3></div><div class="mdb">${mdlite(hint ? r.text_md : r.body_md)}</div></section>`;
    }).join('');
    return `<section class="sw-help" aria-label="Prepared problem help">${conceptual && h.think_first_md ? `<div class="sw-think"><h3>Think first</h3><div class="mdb">${mdlite(h.think_first_md)}</div></div>` : ''}<div class="sw-reveals">${revealed}</div><div class="sw-help-actions">${state.steps < steps.length ? `<button data-reading="step">${conceptual ? (state.steps ? 'Next explanation' : 'Show solution') : (state.steps ? 'Next solution step' : 'Show solution')}</button>` : ''}</div></section>`;
  }
  repaintHelp() { const slot = (this.el?.read || this.t.el.stream).querySelector('.sw-help'); if (slot) { slot.outerHTML = this.helpHTML(this.t.thread.book_problem); math(this.el?.read || this.t.el.stream);this.t.refs?.render(); } }
  visiblePart(){
    if(!this.el?.read.getClientRects().length)return this.view().part??-1;
    const top=this.el.read.getBoundingClientRect().top;
    return [...this.el.read.querySelectorAll('.lr-explanation>section')].findIndex(n=>{const r=n.getBoundingClientRect();return r.top<=top+65&&r.bottom>top+65});
  }
  visibleContext() {
    const p = this.t.thread?.book_problem;
    if (!p) {
      const s=this.selected();if(!s)return null;
      const view=this.view(),lesson=s.lesson||{},parts=(lesson.parts||[]).filter(r=>r.body_md?.trim()!==lesson.summary?.trim());
      let title=s.title,text=s.summary||lesson.summary||'',kind='prepared_lesson',index=this.visiblePart();
      if(view.tab==='examples'){
        index=Math.max(0,Math.min((lesson.examples?.length||1)-1,Number(view.example)||0));const e=lesson.examples?.[index];
        if(e){title=e.title;text=[e.setup_md,...(e.steps||[]).map(r=>[r.math,r.why].filter(Boolean).join(' ? ')),e.answer_md,e.check_md].filter(Boolean).join('\n\n');kind='prepared_example';}
      }else if(view.tab==='practice'){
        const practice=lesson.practice||{};title='Try it: '+s.title;text=[practice.question_md,...(practice.hints||[]).slice(0,view.hints||0),view.answer?practice.answer_md:null].filter(Boolean).join('\n\n');kind='prepared_practice';index=view.hints||0;
      }else if(parts[index]){title=parts[index].title;text=parts[index].body_md;}
      if(s.reader_visual)text+='\n\n'+(view.visualOpen===false?'Closed visual: ':'Visible diagram: ')+s.reader_visual.title+(view.visualOpen===false?'':'; '+JSON.stringify(this.visual.state()));
      return {section_id:s.id,part_kind:kind,part_index:Math.max(0,index),title,text,hints_shown:view.hints||0,solution_shown:!!view.answer,surface:'lesson'};
    }
    const state = this.progress(p), h = p.prepared_help;
    const guidance = validatedGuidance(p);
    const last = state.order.at(-1), step = last && h?.[last.field]?.[last.index];
    const showing=!!p.visual&&this.view().visualOpen!==false;
    return {title:showing?'Problem setup: '+p.title:step?.title||p.title,
      text:[p.statement_md||p.statement||p.title,step?.body_md||step?.text_md,this.view().guidanceOpen&&guidance?.source.classification==='authored_exact'?'Visible reference ('+guidance.topic+'): '+guidance.method_md+'\n'+guidance.relations_md:null,showing?'Current setup: '+JSON.stringify(this.t.book?.visualState()):'Setup is not currently shown.'].filter(Boolean).join('\n\n'),
      section_id:p.id,part_kind:showing?'prepared_problem_visual':step?'prepared_problem_help':'prepared_problem',
      part_index:last?last.index+1:0,hints_shown:state.hints,solution_steps_shown:state.steps,solution_shown:state.steps>0,surface:showing?'setup':'problem'};
  }
  html(t) { return ''; }
}
