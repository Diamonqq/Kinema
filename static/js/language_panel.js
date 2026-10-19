import { esc } from './md.js';

const fold = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
const CORE = {
  '.tv-nav [data-act="new-chat"] span':'new_chat', '.tv-nav [data-act="daily"] span':'daily_problem',
  '.tv-nav [data-act="path"] span':'study_path', '.tv-nav [data-act="library"] span':'library',
  '.tv-side>.tv-label':'chats', '.tv-readhd':'reading_size', '.tv-readreset':'reset',
  '#tv-ask':'ask', '#tv-tochat':'chat', '#tv-lesson':'back_to_lesson', '.tv-topic-toggle':'study_notes',
  '.tv-topic>header h2':'study_notes', '.tv-picker-closed':'sections', '.tv-picker-open':'back_notes',
  '[data-book="tab"][data-tab="lessons"]':'lessons', '[data-book="tab"][data-tab="problems"]':'problems_exercises',
  '[data-book="kind"][data-kind=""]':'all', '[data-book="kind"][data-kind="problem"]':'problems', '[data-book="kind"][data-kind="exercise"]':'exercises',
  '[data-folder-action="create"]':'new_folder', '[data-folder-action="add"]':'add_folder', '[data-folder-action="rename"]':'rename',
  '[data-book="retry"]':'try_again', '[data-folder-action="retry"]':'try_again', '[data-folder-action="cancel"]':'cancel',
  '#libtabs [data-collection="catalog"] span':'problems', '#libtabs [data-collection="folders"] span':'folders',
  '#libtabs [data-tab="simulations"] span':'visuals', '#libtabs [data-tab="materials"] span':'materials', '#libtabs [data-tab="graphs"] span':'graphs',
  '.tv-related-link[data-topic="related"]':'choose_concept',
};
// Only product controls and fixed UI headings are eligible. Never walk chat text,
// problem statements, lesson paragraphs, user titles, folder names or equations.
const LABELS = '.tv-readpop button>span,.tv-lesson-tabs button,.tv-page-nav button,.tv-page-nav button>span,.tv-page-end,.tv-question-return,.tv-related-back,.tv-related-link,.tv-problem-solution-link,.tv-pane-help,.tv-welcome h1,.tv-welcome h2,.tv-book-back span,.book-list small,.book-filter button,.book-more,.pp-workspace-tabs button,.lib-tabs button,.library-tabs button,.folder-heading>h2,.pg-h,.tv-reading-page h4,.tv-page-eyebrow,[data-localize="account"] button,[data-localize="account"] button>span,[data-localize="account"] h1,[data-localize="account"] h2,[data-localize="account"] h3,[data-localize="account"] label,[data-localize="account"] legend,[data-localize="account"] .ka-menu-label';
const ATTRIBUTES = [
  ['#tv-input','placeholder','composer_placeholder'], ['#tv-input','aria-label','message_tutor'],
  ['[data-book-search]','placeholder','find_question'], ['[data-book-search]','aria-label','search_questions'],
  ['[data-act="attach"]','aria-label','attach_files'], ['[data-act="attach"]','title','attach_files'],
  ['#tv-shot','aria-label','screenshot'], ['#tv-shot','title','screenshot'],
  ['#tv-read','aria-label','reading_size'], ['#tv-read','title','reading_size'],
  ['#tv-latest','aria-label','jump_latest'], ['#tv-latest','title','jump_latest'],
];

export class LanguagePanel {
  constructor({api, url = value => value, teacher = null}) {
    this.api = api || (async (path, options) => { const r = await fetch(path, options); if (!r.ok) throw Error(r.statusText); return r.json(); });
    this.url = url; this.teacher = teacher; this.language = 'en'; this.tutorLanguage = 'auto'; this.base = {}; this.messages = {}; this.catalog = []; this.cache = new Map(); this.bindings = new WeakMap();
    this.dialog = document.createElement('dialog'); this.dialog.className = 'kinema-language-dialog'; this.dialog.setAttribute('aria-labelledby','kinema-language-title'); document.body.append(this.dialog);
    this.dialog.addEventListener('click', e => {
      if (e.target.closest('[data-language-close]')) this.close();
      const choice = e.target.closest('[data-language-id]'); if (choice) this.choose(choice.dataset.languageId);
    });
    this.dialog.addEventListener('input', e => { if (e.target.matches('[data-language-search]')) { this.query = e.target.value; this.renderChoices(); } });
    this.dialog.addEventListener('change', e => { if (e.target.matches('[data-tutor-language]')) this.chooseTutor(e.target.value); });
    this.dialog.addEventListener('cancel', () => { this.query = ''; });
    this.dialog.addEventListener('close', () => this.returnFocus?.focus?.({preventScroll:true}));
    this.dialog.addEventListener('keydown', e => this.keys(e));
  }
  async init() {
    const [catalog, english, saved] = await Promise.all([
      this.api(this.url('/locales/catalog.json')), this.api(this.url('/locales/en.json')),
      this.api(this.url('/api/languages')).catch(() => null),
    ]);
    this.catalog = catalog.languages || catalog; this.base = english; this.cache.set('en', english);
    this.englishKeys = new Map(Object.entries(english).filter(([,text]) => !text.includes('{')).map(([key,text]) => [text,key]));
    this.englishKeys.set('Concept','concepts');
    this.language = this.catalog.some(x => x.id === saved?.ui_language) ? saved.ui_language : 'en';
    this.tutorLanguage = saved?.tutor_language === 'auto' || this.catalog.some(x => x.id === saved?.tutor_language) ? saved.tutor_language : 'auto';
    this.messages = await this.load(this.language); this.applyLanguage();
    this.observer = new MutationObserver(() => this.schedule()); this.observe(); this.apply(document); return this;
  }
  async load(id) {
    if (!this.catalog.some(x => x.id === id)) throw Error('Unknown language');
    if (!this.cache.has(id)) this.cache.set(id, await this.api(this.url('/locales/' + encodeURIComponent(id) + '.json')));
    return this.cache.get(id);
  }
  t(key, fallback = '', vars = {}) {
    const value = this.messages[key] || this.base[key] || fallback || key;
    return String(value).replace(/\{([a-zA-Z_]+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
  }
  applyLanguage() {
    const selected = this.catalog.find(x => x.id === this.language);
    document.documentElement.lang = this.language; document.documentElement.dir = selected?.direction || 'ltr';
    document.documentElement.classList.toggle('kinema-rtl', selected?.direction === 'rtl');
    this.teacher?.host?.setAttribute('data-ui-language',this.language);
    this.apply(document);
    document.dispatchEvent(new CustomEvent('kinema-language-change',{detail:{ui_language:this.language,tutor_language:this.tutorLanguage}}));
  }
  observe() { this.observer?.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title','data-i18n','data-action']}); }
  schedule() {
    if (this.scheduled) return; this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.apply(document); });
  }
  nodes(root, selector) { return [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)]; }
  setText(element, key, vars = {}) {
    if (!element || element.closest('.kinema-language-dialog')) return;
    const value = this.t(key,'',vars);
    // Preserve icons, children, event handlers and selected input state.
    const nodes = [...element.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (nodes.length === 1) { if (nodes[0].textContent.trim() !== value) nodes[0].textContent = value; }
    else if (!element.children.length && element.textContent !== value) element.textContent = value;
  }
  translateDirect(element) {
    for (const node of [...element.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const current = node.textContent.trim(), bound = this.bindings.get(node);
      let key = this.englishKeys?.get(current);
      if (!key && bound?.last === current) key = bound.key;
      if (!key) continue;
      const translated = this.t(key); this.bindings.set(node,{key,last:translated});
      if (current !== translated) node.textContent = translated;
    }
  }
  apply(root = document) {
    if (!this.base || !Object.keys(this.base).length) return;
    this.observer?.disconnect();
    try {
      for (const [selector,key] of Object.entries(CORE)) for (const node of this.nodes(root,selector)) this.setText(node,key);
      for (const node of this.nodes(root,LABELS+',.ka-intro,.ka-billing,.ka-browse-note,.ka-field-note,.ka-same-model>span,.ka-connected,.ka-connect-label,.ka-legacy,[data-ka-storage] option')) this.translateDirect(node);
      for (const node of this.nodes(root,'[data-ka-connect] [name="api-key"]')) if(node.placeholder!==this.t('api_key_placeholder')) node.placeholder=this.t('api_key_placeholder');
      for (const node of this.nodes(root,'.ka-provider-heading h1,[data-ka-connect] button[type="submit"]')) {
        const current=node.textContent.trim(), match=current.match(/^Connect (.+)$/), bound=this.bindings.get(node);
        const provider=match?.[1] || (bound?.last===current?bound.provider:null);
        if(provider){const text=this.t('connect_provider','',{provider});this.bindings.set(node,{provider,last:text});if(current!==text)node.textContent=text;}
      }
      for (const node of this.nodes(root,'[data-i18n]')) {
        let vars = {}; try { vars = JSON.parse(node.dataset.i18nVars || '{}'); } catch { }
        this.setText(node,node.dataset.i18n,vars);
      }
      for (const [selector,attribute,key] of ATTRIBUTES) for (const node of this.nodes(root,selector)) { const text = this.t(key); if (node.getAttribute(attribute) !== text) node.setAttribute(attribute,text); }
      for (const node of this.nodes(root,'#tv-send')) {
        const action = node.dataset.action, key = action === 'send' ? 'send' : action === 'stop' || action === 'cancel' ? 'stop' : 'dictate';
        for (const attr of ['aria-label','title']) if (node.getAttribute(attr)!==this.t(key)) node.setAttribute(attr,this.t(key));
      }
      for (const node of this.nodes(root,'[data-act="side"]')) {
        const key = node.classList.contains('tv-reveal') ? 'show_sidebar' : 'hide_sidebar';
        if (node.tagName==='BUTTON') for (const attr of ['aria-label','title']) if (node.getAttribute(attr)!==this.t(key)) node.setAttribute(attr,this.t(key));
      }
      for (const node of this.nodes(root,'[data-book-scope] option')) this.setText(node,node.value==='all'?'all_chapters':'chapter',{n:node.value});
      for (const node of this.nodes(root,'.tv-topic .tv-reading-page h4,.tv-topic-mobile .tv-reading-page h4')) {
        const match = node.textContent.trim().match(/^(Step|Hint) (\d+)$/);
        if (match) { node.dataset.i18n=match[1]==='Step'?'step':'hint';node.dataset.i18nVars=JSON.stringify({n:match[2]});this.setText(node,node.dataset.i18n,{n:match[2]}); }
      }
      for (const node of this.nodes(root,'#tv-input,.tv-book-statement,.tv-page-copy,.tv-example-title,.tv-topic-article>header h3,.book-list button>span,.tv-threads button,.u-msg,.amsg')) if (node.getAttribute('dir')!=='auto') node.setAttribute('dir','auto');
      for (const body of this.nodes(root,'.tv-topic-body,.tv-topic-mobile')) {
        let cue = body.querySelector(':scope>.tv-original-language');
        if (this.language==='en') cue?.remove();
        else { if (!cue) { cue=document.createElement('p');cue.className='tv-original-language';body.append(cue); } const text=this.t('original_content');if(cue.textContent!==text)cue.textContent=text; }
      }
    } finally { this.observe(); }
  }
  open() {
    this.returnFocus = document.activeElement; this.query=''; this.error=''; this.render();
    if (!this.dialog.open) this.dialog.showModal(); this.dialog.querySelector('[data-language-search]').focus();
  }
  close() { this.dialog.close(); }
  render() {
    this.dialog.dir = this.catalog.find(x=>x.id===this.language)?.direction || 'ltr';
    this.dialog.innerHTML=`<header><h2 id="kinema-language-title">${esc(this.t('choose_language'))}</h2><button type="button" data-language-close aria-label="${esc(this.t('close'))}">×</button></header><label class="language-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input type="search" data-language-search autocomplete="off" placeholder="${esc(this.t('search_languages'))}" aria-label="${esc(this.t('search_languages'))}" value="${esc(this.query||'')}"></label><div class="language-options" aria-label="${esc(this.t('ui_language'))}"></div><footer><label><span>${esc(this.t('tutor_language'))}</span><select data-tutor-language ${this.saving?'disabled':''}><option value="auto">${esc(this.t('same_as_interface'))}</option>${this.catalog.map(x=>`<option value="${esc(x.id)}" ${this.tutorLanguage===x.id?'selected':''}>${esc(x.native)}</option>`).join('')}</select></label><p>${esc(this.t('original_content'))}</p><div class="language-error" role="alert" ${this.error?'':'hidden'}>${esc(this.error||'')}</div></footer>`;
    this.renderChoices();
  }
  renderChoices() {
    const box=this.dialog.querySelector('.language-options'); if(!box)return;
    const query=fold(this.query||''), rows=this.catalog.filter(x=>fold(x.name+' '+x.native+' '+x.id).includes(query));
    box.innerHTML=rows.map(x=>`<button type="button" data-language-id="${esc(x.id)}" aria-pressed="${x.id===this.language}" ${this.saving?'disabled':''}><span><strong dir="auto">${esc(x.native)}</strong><small dir="ltr">${esc(x.name)}</small></span>${x.id===this.language?'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>':''}</button>`).join('')||`<p class="language-empty">${esc(this.t('no_languages'))}</p>`;
  }
  async save(nextUI,nextTutor) {
    if(this.saving)return false;this.saving=true;this.error='';this.renderChoices();const select=this.dialog.querySelector('[data-tutor-language]');if(select)select.disabled=true;
    try {
      const messages=await this.load(nextUI);
      await this.api(this.url('/api/settings'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ui_language:nextUI,tutor_language:nextTutor})});
      this.language=nextUI;this.tutorLanguage=nextTutor;this.messages=messages;this.applyLanguage();return true;
    }catch(error){this.error=this.t('save_failed');return false;}
    finally{this.saving=false;if(this.dialog.open)this.render();}
  }
  async choose(id) { if(!this.catalog.some(x=>x.id===id))return;if(await this.save(id,this.tutorLanguage))this.close(); }
  async chooseTutor(id) { if(id!=='auto'&&!this.catalog.some(x=>x.id===id))return;await this.save(this.language,id); }
  keys(event) {
    const button=event.target.closest('[data-language-id]');if(!button)return;
    const buttons=[...this.dialog.querySelectorAll('[data-language-id]:not(:disabled)')],index=buttons.indexOf(button),columns=getComputedStyle(this.dialog.querySelector('.language-options')).gridTemplateColumns.split(' ').length,rtl=this.dialog.dir==='rtl';
    let next=index;
    if(event.key==='ArrowDown')next+=columns;else if(event.key==='ArrowUp')next-=columns;else if(event.key==='ArrowRight')next+=rtl?-1:1;else if(event.key==='ArrowLeft')next+=rtl?1:-1;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;
    event.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,next))]?.focus();
  }
  destroy(){this.observer?.disconnect();this.dialog.remove();}
}
