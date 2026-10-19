import { TeachingVisual } from './teaching_visual.js';
/* One persistent visual host: closing pauses it; resizing never rebuilds the model. */
export class ProblemArtifact {
  constructor({onPause, onResize, onDetails, onChange}) {
    if (!document.querySelector('link[data-library-style]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.dataset.libraryStyle = '1';
      css.href = new URL('../visual_library.css', import.meta.url).href; document.head.append(css);
    }
    this.onChange = onChange;
    this.root = document.querySelector('#workspace');
    this.pane = document.querySelector('#problem-artifact');
    this.chat = document.querySelector('#pane');
    this.header = document.querySelector('body>header');
    this.onPause = onPause; this.onResize = onResize; this.onDetails = onDetails;
    this.stage=this.pane.querySelector('#stage');
    this.caption=document.createElement('p');this.caption.className='artifact-caption';this.caption.hidden=true;
    this.teachingHost=document.createElement('div');this.teachingHost.className='teaching-visual';this.teachingHost.hidden=true;
    this.pane.append(this.caption,this.teachingHost);this.diagram=new TeachingVisual(this.teachingHost);
    this.narrow = matchMedia('(max-width:900px)');
    this.opened = false; this.expanded = false; this.active = false;
    this.pane.querySelector('[data-artifact-close]').onclick = () => this.open(false);
    this.pane.querySelector('[data-artifact-expand]').onclick = () => this.expand(!this.expanded);
    this.pane.querySelector('[data-artifact-details]').onclick = e => {
      const value = this.pane.classList.toggle('show-details');
      e.currentTarget.setAttribute('aria-pressed', String(value));
      requestAnimationFrame(() => this.onDetails?.());   // after layout: the Layers panel changes the stage's free area
    };
    this.narrow.addEventListener('change', () => this.sync());
    document.addEventListener('keydown', e => {
      if (!this.active || !this.opened || document.querySelector('dialog[open],.tv-readpop:not([hidden]),.model-popover')) return;   // the active menu or dialog owns Escape and Tab
      if (e.key === 'Escape' && (this.expanded || !this.inline || this.pane.contains(document.activeElement))) { e.preventDefault(); e.stopImmediatePropagation(); if (this.expanded) this.expand(false); else this.open(false); return; }
      if (e.key !== 'Tab' || !(this.expanded || (!this.inline && this.narrow.matches))) return;
      const nodes = [...this.pane.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(x => x.getClientRects().length && !x.disabled);
      const first = nodes[0], last = nodes.at(-1);
      if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first?.focus(); }
    }, true);
  }
  configure(kind, title) {
    this.clearScene();
    this.diagram.reset();this.teaching=false;this.teachingHost.hidden=true;this.stage.hidden=false;this.caption.hidden=true;
    this.available = !!kind && kind !== 'none';
    this.label = ({rigid3d:'3D model', mechanics:'Simulation', plot:'Graph', circuit:'Circuit', diagram:'Diagram'})[kind] || 'Visual';
    this.pane.querySelector('.artifact-name').textContent = this.label;
    this.pane.setAttribute('aria-label', `${this.label}: ${title || 'Physics problem'}`);
    this.pane.classList.remove('show-details');
    this.pane.querySelector('[data-artifact-details]').setAttribute('aria-pressed','false');
    this.open(false, false);
  }
  setStep(view) {
    this.teaching=!!view && view.kind!=='native';
    this.teachingHost.hidden=!this.teaching;this.stage.hidden=this.teaching;
    this.pane.classList.toggle('has-caption',!!view?.caption);
    this.caption.textContent=this.caption.title=view?.caption||'';this.caption.hidden=!view?.caption;
    this.pane.querySelector('[data-artifact-details]').hidden=this.teaching;
    const label=view?.title||this.label;
    this.pane.querySelector('.artifact-name').textContent=label;this.pane.setAttribute('aria-label',label);
    this.chat.querySelectorAll('.artifact-card b').forEach(el=>el.textContent=label);
    if(this.teaching){this.onPause();this.diagram.set(view);}
    else this.diagram.view=null;
    this.sync();
  }
  /* The tutor view hosts this same pane (and its renderer) beside its own chat; moving it never rebuilds the model. */
  attach(root, chat, slot) {
    if (this.root === root) return;
    this.root.classList.remove('visual-open', 'visual-expanded', 'visual-inline'); this.chat.inert = false;
    this.inline = false; this.inlineSlot = null;
    this.root = root; this.chat = chat; this.parking = slot || root; this.parking.append(this.pane); this.sync();
  }
  /* The native DOM survives message redraws and fullscreen. Only its host moves. */
  parkInline() {
    if (this.inline && !this.expanded && this.parking && this.pane.parentElement !== this.parking) { this.pane.hidden = true; this.parking.append(this.pane); }
  }
  mountInline(slot) {
    if (this.inline === !!slot && this.inlineSlot === slot) return;
    this.inline = !!slot; this.inlineSlot = slot;
    this.place(); this.sync();
  }
  place() {
    const host = this.inline && !this.expanded && this.inlineSlot?.isConnected ? this.inlineSlot : this.parking;
    if (host && this.pane.parentElement !== host) host.append(this.pane);
  }
  expand(value) {
    this.expanded = value; this.place(); this.sync();
    this.pane.querySelector('[data-artifact-expand]')?.focus({preventScroll:true});
  }
  /* A prepared Daily scene (daily_visuals.js handle contract) in place of the stage; destroyed on close, switch or reconfigure. */
  clearScene() {
    this.sceneToken = (this.sceneToken || 0) + 1;
    const h = this.sceneHandle; this.sceneHandle = null;
    try { h?.destroy?.(); } catch { /* a viewer that fails to free itself must not block closing */ }
    if (this.sceneHost) { this.sceneHost.remove(); this.sceneHost = null; }
    this.pane.classList.remove('has-scene');
    this.stage.hidden = !!this.teaching;
  }
  async showScene(title, mount) {
    this.configure('diagram', title);
    const token = this.sceneToken, host = this.sceneHost = document.createElement('div');
    host.className = 'artifact-scene'; this.pane.append(host); this.pane.classList.add('has-scene');
    this.stage.hidden = true; this.teachingHost.hidden = true; this.caption.hidden = true;
    this.pane.classList.remove('has-caption');
    this.label = 'Scene'; this.pane.querySelector('.artifact-name').textContent = title; this.pane.setAttribute('aria-label', 'Scene: ' + title);
    this.pane.querySelector('[data-artifact-details]').hidden = true;
    this.available = true; this.open(true, false);
    let handle;
    try { handle = await mount(host); } catch (e) { if (token === this.sceneToken) return { ok: false, error: e.message || 'The viewer could not start.' }; return { ok: false, cancelled: true }; }
    if (token !== this.sceneToken) { try { handle?.destroy?.(); } catch { /* superseded */ } return { ok: false, cancelled: true }; }
    this.sceneHandle = handle; requestAnimationFrame(() => handle?.resize?.());
    return { ok: true, handle };
  }
  context() { return this.diagram.snapshot(); }
  lock(value) { this.teachingHost.inert=value; }
  setActive(active) { this.active = active; if (!active) this.onPause(); this.sync(); }
  open(value = true, focus = true) {
    if (value && !this.available) return;
    if (value) this.opener = document.activeElement;
    this.opened = value;
    if (!value) { this.expanded = false; this.onPause(); this.clearScene(); }
    this.sync();
    if (focus) (value ? this.pane.querySelector('[data-artifact-close]') : this.opener?.isConnected ? this.opener : this.chat.querySelector('[data-visual]'))?.focus({preventScroll:true});
  }
  sync() {
    this.place();
    const modal = this.active && this.opened && (this.expanded || (!this.inline && this.narrow.matches));
    this.pane.hidden = !this.opened;
    this.root.classList.toggle('visual-inline', !!this.inline);
    this.root.classList.toggle('visual-open', this.opened && !this.inline);
    this.root.classList.toggle('visual-expanded', this.opened && this.expanded);
    this.chat.inert = modal; this.header.inert = modal;
    this.onChange?.(this.opened, this.expanded);
    this.pane.toggleAttribute('aria-modal', modal);
    if (modal) { this.pane.setAttribute('role','dialog'); this.pane.setAttribute('aria-modal','true'); }
    else { this.pane.removeAttribute('role'); this.pane.removeAttribute('aria-modal'); }
    const expand = this.pane.querySelector('[data-artifact-expand]');
    expand.setAttribute('aria-label', this.expanded ? 'Restore visual size' : 'Expand visual');
    expand.innerHTML = this.expanded ? '↙' : '↗';
    this.chat.querySelectorAll('[data-visual]').forEach(b => b.setAttribute('aria-expanded', String(this.opened)));
    if (modal && !this.pane.contains(document.activeElement)) this.pane.querySelector('[data-artifact-close]').focus({preventScroll:true});
    if (this.active && this.opened) requestAnimationFrame(() => { this.onResize(); this.sceneHandle?.resize?.(); });
  }
}
