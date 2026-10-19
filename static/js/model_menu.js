import { esc } from './md.js';
import { modelName, effortLabel, setModelCatalog } from './model_identity.js';
import { loadUsage, usageCached, usageHTML, resetUsageCache } from './account_usage.js';

let config, menu;
const contexts = new WeakMap();
// The bar lists only the account Kinema uses (chosen in Settings › Account), so its models appear automatically.
const accountOf = m => String(m.id).split(':', 1)[0];
const listed = () => (config?.models || []).filter(m => accountOf(m) === config.account);
const roles = {chat:['Chat tutor','Conversation, plans and answer checks'], build:['Lessons & visuals','Worked lessons and interactive models'], notes:['Reference notes','Background note writing and checking']};
const svg = paths => '<svg viewBox="0 0 20 20" aria-hidden="true">'+paths+'</svg>';
const bolt = svg('<path d="M11.5 2 4.5 11h5l-1 7 7-10h-5Z"/>');
const reset = svg('<path d="M4 7a6 6 0 1 1 0 6M4 3v4h4"/>');
const ring = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/></svg>';
const caret = '<svg class="pn-eff-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="m3.2 4.6 2.8 2.8 2.8-2.8"/></svg>';
const chevron = '<svg class="km-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="m4.6 3.2 2.8 2.8-2.8 2.8"/></svg>';
const chevronBack = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m7.4 3.2-2.8 2.8 2.8 2.8"/></svg>';
// Panel's effort slider: the thumb's centre travels between 12px and (width - 12px), so the fill stops there too.
const fillAt = (i, max) => 'calc(12px + (100% - 24px) * '+(max > 0 ? i / max : 0)+')';
// Panel's ONE model control: Fast mark, model, effort and a single caret share one button.
const supported = c => !!c?.model && !!config?.models?.some(m=>m.id===c.model);
const displayName = c => c?.model && !supported(c) ? 'Choose model' : c?.label || modelName(c?.model || c?.id, 'Model');
const providerName = m => ({openai:'OpenAI',anthropic:'Claude',claude:'Claude',gemini:'Gemini','gemini-cli':'Gemini',google:'Gemini',kimi:'Kimi','kimi-cli':'Kimi',openrouter:'OpenRouter',codex:'ChatGPT',local:'Local'})[m.provider || String(m.id).split(':')[0]] || m.provider || 'Other models';
const defaultEffort = m => m?.efforts?.includes(m.default_effort) ? m.default_effort : m?.efforts?.includes('medium') ? 'medium' : m?.efforts?.[0];
const capName = c => esc(displayName(c)).replace(/^Claude /, '<span class="pn-cap-family">Claude </span>');
const capLabel = c => (supported(c) && c?.speed === 'fast' ? bolt.replace('<svg', '<svg class="pn-mc-bolt"') : '')+'<span class="capname">'+capName(c)+'</span>'+(supported(c) ? '<span class="pn-mc-effort">'+esc(effortLabel(c.effort, c.model) || 'Choose effort')+'</span>' : '')+caret;
const effortText = c => esc(effortLabel(c?.effort, c?.model) || 'Effort') + (c?.speed === 'fast' ? '<span class="km-fast-label">'+bolt+'Fast</span>' : '');

export function tidyModels(models,current) {
  const rows=models.map(m=>({...m,label:(m.provider==='claude'&&!/^Claude /.test(m.label)?'Claude ':'')+m.label}));
  const version=id=>{const v=id.match(/(?:gpt-|(?:haiku|sonnet|opus|fable)-)(\d+)(?:[.-](\d+))?/);return v?Number(v[1])+Number(v[2]||0)/100:0};
  const family=id=>id.includes('gpt-')?(id.match(/-(astra|sol|luna|mini|nano|terra)(?:$|-)/)?.[1]||'gpt'):(id.match(/haiku|sonnet|opus|fable/)?.[0]||id);
  return rows.filter(m=>m.id===current||!/^claude:(haiku|sonnet|opus)$/.test(m.id)||!rows.some(n=>n.id!==m.id&&family(n.id)===family(m.id)&&version(n.id)>0))
    .map(m=>({...m,older:/fable-5-1|gpt-5[.-]/.test(m.id)||rows.some(n=>family(n.id)===family(m.id)&&version(n.id)>version(m.id))}))
    .sort((a,b)=>Number(b.id===current)-Number(a.id===current)||Number(a.older)-Number(b.older)||b.label.localeCompare(a.label,undefined,{numeric:true}));
}

export function modelButton(role = 'chat', context = true, single = false) {
  const c = config?.roles[role];
  if (single) return '<span class="model-controls is-single" data-model-role="'+role+'">'+(context ? '<button type="button" class="context-choice" data-model-control="context" aria-label="Context and token usage" title="Context and token usage" aria-haspopup="dialog" aria-expanded="false">'+ring+'</button>' : '')+'<button type="button" class="model-choice" data-model-control="effort" aria-haspopup="dialog" aria-expanded="false" title="Model, effort and speed">'+capLabel(c)+'</button></span>';
  return '<span class="model-controls" data-model-role="'+role+'"><button type="button" class="model-choice" data-model-control="model" aria-haspopup="dialog" aria-expanded="false" title="Choose model"><span>'+esc(displayName(c))+'</span></button><button type="button" class="effort-choice" data-model-control="effort" aria-haspopup="dialog" aria-expanded="false" title="Thinking effort and speed">'+effortText(c)+'</button>'+(context ? '<button type="button" class="context-choice" data-model-control="context" aria-label="Context and token usage" title="Context and token usage" aria-haspopup="dialog" aria-expanded="false">'+ring+'</button>' : '')+'</span>';
}

export function updateModelContext(host, context) {
  host.querySelectorAll('.model-controls').forEach(el => contexts.set(el, context));
  if (menu?.kind === 'context' && host.contains(menu.anchor)) menu.render();
}

// Panel's cached model list, separate effort slider and context ring.
// A committed choice is saved immediately; running requests keep their snapshot.
export class ModelMenu {
  constructor(deps) {
    this.d = deps; menu = this; this.preferences = new Map();
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-model-control]');
      if (!b) return;
      e.preventDefault();
      this.open(b.dataset.modelControl, b);
    });
    document.addEventListener('keydown', e => {
      if (this.pop && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(true); }
    }, true);
    document.addEventListener('pointerdown', e => {
      if (this.pop && !this.pop.contains(e.target) && !e.target.closest('[data-model-control]')) this.close();
    });
    document.addEventListener('focusin', e => {
      if (this.pop && !this.pop.contains(e.target) && e.target !== this.anchor) this.close();
    });
    this.reposition = () => this.place();
    addEventListener('resize', this.reposition);
    window.visualViewport?.addEventListener('resize', this.reposition);
    document.addEventListener('scroll', this.reposition, true);
    this.load().catch(() => {});
  }
  async load() {
    const next = await this.d.api(this.d.url('/api/models'));
    if(config?.account!==next.account)resetUsageCache();
    config=next;
    setModelCatalog(config.models);
    this.sync(); return config;
  }
  get current() { return config; }
  sync() {
    document.querySelectorAll('.model-controls').forEach(el => {
      const c = config?.roles[el.dataset.modelRole]; if (!c) return;
      if (el.classList.contains('is-single')) el.querySelector('.model-choice').innerHTML = capLabel(c);
      else { el.querySelector('.model-choice span').textContent = displayName(c); el.querySelector('.effort-choice').innerHTML = effortText(c); }
      el.querySelector('.model-choice').setAttribute('aria-label', [displayName(c), supported(c) && effortLabel(c.effort, c.model), supported(c) && c.speed === 'fast' ? 'Fast' : ''].filter(Boolean).join(' · '));
      el.querySelectorAll('button').forEach(b => b.disabled = !!this.saving);
    });
  }
  async open(kind, anchor) {
    if (this.saving) return;
    if (this.pop && anchor === this.anchor) { this.close(true); return; }
    if (!config) {
      try { await this.load(); } catch(e) { this.d.toast(e.message); return; }
      if (!anchor.isConnected) return;
    }
    this.close(); this.kind = kind; this.anchor = anchor; this.query = ''; this.limit = 40; this.browsed = false;
    this.role = anchor.closest('[data-model-role]')?.dataset.modelRole || 'chat';
    this.pop = document.createElement('section');
    this.pop.className = 'model-popover km-'+kind;
    this.pop.setAttribute('popover', 'manual'); this.pop.setAttribute('role', 'dialog');
    this.pop.setAttribute('aria-label', {model:'Select model', effort:'Thinking effort and speed', context:'Context and token usage'}[kind]);
    (anchor.closest('dialog') || document.body).append(this.pop);
    this.pop.addEventListener('toggle', e => { if (e.newState === 'closed' && this.pop === e.target) this.close(); });
    this.pop.addEventListener('click', e => this.act(e));
    this.pop.addEventListener('input', e => {
      if (e.target.matches('[data-effort-range]')) this.paintEffort(e.target, true);
      else if (e.target.matches('[data-model-search]')) { this.query = e.target.value; this.limit = 40; this.renderModelResults(); }
    });
    this.pop.addEventListener('change', e => {
      if (e.target.matches('[data-effort-range]')) this.save({effort:this.paintEffort(e.target, false)});
    });
    this.pop.addEventListener('keydown', e => this.key(e));
    this.render(); this.pop.showPopover({source:anchor}); anchor.setAttribute('aria-expanded', 'true'); this.place();
    (this.pop.querySelector('[aria-selected=true], [data-effort-range], button') || this.pop).focus({preventScroll:true});
    this.observer = new MutationObserver(() => { if (!this.anchor?.isConnected || !this.anchor.getClientRects().length) this.close(); });
    this.observer.observe(document.body, {childList:true, subtree:true});
  }
  close(focus = false) {
    const pop = this.pop, anchor = this.anchor;
    this.pop = null; this.anchor = null; this.kind = null; this.restoreFocus = null; this.observer?.disconnect();
    clearTimeout(this.usageTimer);
    pop?.remove(); anchor?.setAttribute('aria-expanded', 'false');
    if (focus && anchor?.isConnected) anchor.focus({preventScroll:true});
  }
  // Panel's anchor rule: the popover's right edge meets the clicked control and it grows leftward,
  // clamped inside the viewport; it opens above the control unless there is more room below.
  place() {
    if (!this.pop || !this.anchor?.isConnected) return;
    if (!this.anchor.getClientRects().length) { this.close(); return; }
    const vv = window.visualViewport, top = vv?.offsetTop || 0, left = vv?.offsetLeft || 0;
    const width = vv?.width || innerWidth, height = vv?.height || innerHeight, a = this.anchor.getBoundingClientRect();
    const p = this.pop;
    p.style.maxWidth = (width - 24)+'px'; p.style.maxHeight = (height - 24)+'px';
    p.style.left = Math.max(left + 12, Math.min(a.right - p.offsetWidth, left + width - p.offsetWidth - 12))+'px';
    const above = a.top - top - 10, below = top + height - a.bottom - 10;
    const up = p.offsetHeight <= above || above >= below;
    p.style.maxHeight = Math.max(80, (up ? above : below) - 12)+'px';
    p.style.top = (up ? Math.max(top + 12, a.top - p.offsetHeight - 8) : a.bottom + 8)+'px';
  }
  view(kind) {
    if (!this.pop) return;
    this.kind = kind; this.browsed = kind === 'model'; this.pop.className = 'model-popover km-'+kind; this.render();
    (this.pop.querySelector(kind === 'model' ? '[aria-selected=true]' : '[data-action=browse]') || this.pop).focus({preventScroll:true});
  }
  render() {
    if (!this.pop) return;
    const c = config.roles[this.role], model = config.models.find(m => m.id === c.model);
    const active = this.restoreFocus || (this.pop.contains(document.activeElement) ? document.activeElement.dataset.action : null);
    this.restoreFocus = null;
    if (this.kind === 'model') {
      this.pop.innerHTML = '<div class="km-heading"><button type="button" class="km-back" data-action="back" aria-label="Back to effort">'+chevronBack+'</button><b>Model</b></div>'+(listed().length>12?'<div class="km-catalog-filters"><input type="search" data-model-search placeholder="Search models" aria-label="Search models" value="'+esc(this.query || '')+'"></div>':'')+'<div class="km-catalog-results"></div>'+(!model ? '<p class="km-note">Saved model: '+esc(modelName(c.model))+'. Choose another to change it.</p>' : '');
      this.renderModelResults();
    } else if (this.kind === 'effort') {
      const levels = model?.efforts || [], idx = levels.indexOf(c.effort), fast = model?.speeds?.includes('fast');
      const at = Math.max(0, idx), max = levels.length - 1;
      this.pop.innerHTML = '<div class="km-eff-head">'+(fast ? '<button type="button" data-action="fast" aria-label="Fast mode" aria-pressed="'+(c.speed === 'fast')+'" title="Fast mode '+(c.speed === 'fast' ? 'on' : 'off')+' · Faster replies use more of your account allowance">'+bolt+'</button>' : '<span class="km-eff-spacer"></span>')+'<div><b data-effort-label>'+esc(model ? effortLabel(c.effort, c.model) : 'Not connected')+'</b><button type="button" class="km-browse" data-action="browse">'+esc(displayName(c))+chevron+'</button></div><button type="button" data-action="reset" aria-label="Reset effort and speed" title="Default effort · Standard speed" '+(levels.length ? '' : 'disabled')+'>'+reset+'</button></div>'+
        (levels.length > 1 ? '<div class="km-slider"><input type="range" data-effort-range data-action="range" min="0" max="'+max+'" step="0.001" value="'+at+'" aria-label="Thinking effort" aria-valuetext="'+esc(effortLabel(c.effort, c.model))+'" style="--eff-fill:'+fillAt(at, max)+'"></div><div class="km-scale" aria-hidden="true"><span>Faster</span><span>Smarter</span></div>' : '<p class="km-note">'+(levels.length === 1 ? 'This model uses '+esc(effortLabel(levels[0],c.model)).toLowerCase()+' effort.' : 'Choose a connected model to adjust effort.')+'</p>');
    } else this.renderContext(c);
    this.pop.insertAdjacentHTML('beforeend', '<p class="km-error" role="alert"></p>');
    if (active) this.pop.querySelector('[data-action="'+active+'"]')?.focus({preventScroll:true});
    this.place();
  }
  renderModelResults() {
    const box = this.pop?.querySelector('.km-catalog-results'); if (!box) return;
    const current = config.roles[this.role]?.model, query = (this.query || '').trim().toLocaleLowerCase();
    const choices = tidyModels(listed(),current), filtered=choices.filter(m=>!query||[m.label,m.id].join(' ').toLowerCase().includes(query));
    const rows=filtered.filter(m=>query||this.showOlder||!m.older||m.id===current).slice(0,this.limit||40);
    box.innerHTML = '<div role="listbox" aria-label="Tutor model">'+rows.map(m=>'<button type="button" class="km-model-row" role="option" aria-selected="'+(m.id===current)+'" data-pick="'+esc(m.id)+'"><span>'+esc(m.label)+'</span><span class="km-check" aria-hidden="true">✓</span></button>').join('')+'</div>'+
      (!query&&choices.some(m=>m.older)?'<button type="button" class="km-show-more" data-action="older-models" aria-expanded="'+!!this.showOlder+'">'+(this.showOlder?'Hide older models':'Show older models')+'</button>':'')+
      (filtered.length>rows.length&&query?'<button type="button" class="km-show-more" data-action="more-models">Show more</button>':'')+
      (!rows.length?'<p class="km-note">'+(listed().length?'No models match that search.':'Connect an account in Settings to choose a model.')+'</p>':'');
    this.place();
  }
  renderContext(c) {
    this.contextTab ||= 'usage';
    const ctx = contexts.get(this.anchor.closest('.model-controls'));
    const reading = [...(ctx?.messages || [])].reverse().map(m => m.context_usage).find(r => r?.model === c.model);
    const counts=[['Input',reading?.input_tokens],['Output',reading?.output_tokens]].filter(([,n])=>Number.isFinite(n));
    const time=counts.length&&reading?.recorded_at?new Date(reading.recorded_at*1000).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'';
    const tabs=['context','usage'].map(id=>'<button type="button" role="tab" data-action="context-tab" data-tab="'+id+'" aria-selected="'+(this.contextTab===id)+'">'+(id==='context'?'Context':'Usage')+'</button>').join('');
    this.pop.innerHTML='<div class="km-context-head"><div class="km-context-tabs" role="tablist" aria-label="Usage view">'+tabs+'</div>'+(this.contextTab==='usage'?'<button class="km-context-refresh" type="button" data-action="usage-refresh" aria-label="Refresh usage" title="Refresh usage">'+reset+'</button>':'')+'</div>'+
      (this.contextTab==='usage'?'<section class="km-usage-body" role="tabpanel" aria-label="Usage">'+this.usageSection(usageCached())+'</section>':
      '<section class="km-context-body" role="tabpanel" aria-label="Context"><div class="km-context-heading"><b>Last request</b><span>'+esc(displayName(c))+'</span></div>'+(counts.length?'<dl>'+counts.map(([k,n])=>'<div><dt>'+k+' tokens</dt><dd>'+n.toLocaleString()+'</dd></div>').join('')+'</dl>':'<p class="km-note">'+(reading?'Tokens not reported by this connection.':'Available after a reply.')+'</p>')+(time?'<p class="km-note">Recorded '+esc(time)+'</p>':'')+'<p class="km-note">Includes the current lesson and recent conversation.</p></section>');
    this.pop.tabIndex=-1;
    if(this.contextTab==='usage')this.refreshUsage(false);
  }
  usageSection(usage) {
    const current=usage?.provider===config.account?usage:null;
    const name={codex:'ChatGPT',claude:'Claude','gemini-cli':'Google Gemini','kimi-cli':'Kimi'}[config.account]||'Account';
    const plan=current?.plan?String(current.plan).replace(/^\w/,ch=>ch.toUpperCase()):'';
    return '<div class="km-context-account"><b>'+esc(name)+(plan?'<span>'+esc(plan)+'</span>':'')+'</b>'+ (usageHTML(current,{compact:true,remaining:true}) || '<p class="km-note">'+(current?.refreshing?'Reading usage…':'No limits reported.')+'</p>')+'</div>'+(this.usageError?'<p class="km-note" role="status">Couldn’t refresh'+(current?' · showing the last reading':'. Try again.')+'</p>':'');
  }
  async refreshUsage(force=false) {
    if(this.usageLoading)return;
    const pop=this.pop,account=config.account;this.usageLoading=true;
    try {
      const usage=await loadUsage(this.d.api,this.d.url,force);this.usageError=false;
      if(this.pop===pop&&this.kind==='context'&&config.account===account){const box=pop.querySelector('.km-usage-body');if(box)box.innerHTML=this.usageSection(usage);this.place();
        if(usage?.refreshing){clearTimeout(this.usageTimer);this.usageTimer=setTimeout(()=>{if(this.pop===pop&&this.contextTab==='usage')this.refreshUsage(true)},2500);}}
    } catch {this.usageError=true;if(this.pop===pop&&config.account===account){const box=pop.querySelector('.km-usage-body');if(box)box.innerHTML=this.usageSection(usageCached());this.place();}}
    finally {this.usageLoading=false;}
  }
  paintEffort(input, magnetic) {
    const levels = config.models.find(m => m.id === config.roles[this.role].model)?.efforts || [];
    let value = +input.value;
    if (magnetic) { const delta = value - Math.round(value), t = Math.abs(delta) / .2; if (t < 1) value = Math.round(value) + Math.sign(delta) * .2 * t*t; }
    else value = Math.round(value);
    input.value = value;
    const index = Math.round(value), effort = levels[index];
    input.style.setProperty('--eff-fill', fillAt(value, +input.max));
    input.setAttribute('aria-valuetext', effortLabel(effort, config.roles[this.role].model));
    this.pop.querySelector('[data-effort-label]').textContent = effortLabel(effort, config.roles[this.role].model);
    return effort;
  }
  key(e) {
    if (e.target.matches('[data-effort-range]') && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) {
      e.preventDefault(); if (this.saving) return;
      const r = e.target, max = +r.max;
      r.value = e.key === 'Home' ? 0 : e.key === 'End' ? max : Math.max(0, Math.min(max, Math.round(+r.value) + (['ArrowRight','ArrowUp'].includes(e.key) ? 1 : -1)));
      this.save({effort:this.paintEffort(r, false)});
    } else if (this.kind === 'model' && !e.target.matches('input,select') && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault(); const rows = [...this.pop.querySelectorAll('[data-pick]')];
      const at = rows.indexOf(document.activeElement), next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length-1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows[next]?.focus();
    }
  }
  act(e) {
    const b = e.target.closest('button'); if (!b || b.disabled || this.saving) return;
    const c = config.roles[this.role];
    if (b.dataset.pick) {
      const m = config.models.find(m => m.id === b.dataset.pick);
      if (!m) return;
      this.preferences.set(this.role + ':' + c.model, {effort:c.effort, speed:c.speed});
      const old = this.preferences.get(this.role + ':' + m.id) || c;
      const effort = m.efforts.includes(old.effort) ? old.effort : defaultEffort(m), speed = m.speeds.includes(old.speed) ? old.speed : 'standard';
      // Picking from the effort view returns there; opening the list directly closes it after the choice.
      const back = this.browsed;
      this.save({model:m.id, effort, speed}, !back).then(saved => { if (saved && back && this.pop) this.view('effort'); });
    } else if (b.dataset.action === 'fast') this.save({speed:c.speed === 'fast' ? 'standard' : 'fast'});
    else if (b.dataset.action === 'reset') this.save({effort:defaultEffort(config.models.find(m=>m.id===c.model)), speed:'standard'});
    else if (b.dataset.action === 'older-models') { this.showOlder=!this.showOlder;this.renderModelResults(); }
    else if (b.dataset.action === 'context-tab') { this.contextTab=b.dataset.tab;this.render();this.pop.querySelector('[data-tab="'+this.contextTab+'"]')?.focus(); }
    else if (b.dataset.action === 'usage-refresh') this.refreshUsage(true);
    else if (b.dataset.action === 'more-models') { this.limit += 40; this.renderModelResults(); }
    else if (b.dataset.action === 'browse') this.view('model');
    else if (b.dataset.action === 'back') this.view('effort');
  }
  async save(patch, close = false) {
    if (this.saving) return;
    const role = this.role, pop = this.pop;
    const choice = {...config.roles[role], ...patch};
    // Include the explicit builder effort, even when inherited from pre-1.9 settings.
    const body = Object.fromEntries(['model','effort','speed'].map(k => [role+'_'+k,choice[k]]));
    this.restoreFocus = pop?.contains(document.activeElement) ? (document.activeElement.matches('[data-effort-range]') ? 'range' : document.activeElement.dataset.action) : null;
    this.saving = true; this.sync();
    pop?.querySelectorAll('button,input').forEach(b => b.disabled = true);
    try {
      await this.d.api(this.d.url('/api/settings'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      await this.load(); this.d.onChange?.();
      if (this.pop === pop) { if (close) this.close(true); else this.render(); }
      return true;
    } catch(e) {
      if (this.pop === pop) { this.render(); this.pop.querySelector('[role=alert]').textContent = e.message; }
      else this.d.toast(e.message);
      return false;
    } finally { this.saving = false; this.sync(); }
  }
}
