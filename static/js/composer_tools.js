/* Composer tools shared by the tutor chat and Daily: dictation (mic) and recent screenshot selection.
   Both start only from a click. Neither claims support it does not have: the mic needs a browser recorder AND the server's
   dictation route (GET /api/dictation/status → {available:true}; POST /api/dictation/transcribe, multipart "file" → {text});
   without them the button stays visible but disabled and says why. Every media track is stopped on finish, cancel, error or page hide. */
export const ICON_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
export const ICON_SHOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3"/></svg>';

const MAX_MS = 120000;
const WORKLET = new URL('./dictation_worklet.js', import.meta.url);

export const screenSupported = () => true;
export { pickScreenshot as captureScreen } from './screenshot_picker.js';
export const recorderSupported = () => !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || window.webkitAudioContext) && typeof AudioWorkletNode !== 'undefined';

let statusPromise = null;
/* is dictation really available here? cached after the first answer; a network error is retried next time. */
export function dictationStatus(api, url, fresh = false) {
  if (!recorderSupported()) return Promise.resolve({ ok: false, reason: 'This browser cannot record from a microphone.' });
  if (!window.isSecureContext) return Promise.resolve({ ok: false, reason: 'The microphone needs a secure (https or localhost) page.' });
  if (!statusPromise || fresh) {
    statusPromise = api(url('/api/dictation/status'), undefined, 6000).then(
      r => (r && r.available ? { ok: true } : { ok: false, reason: (r && r.reason) || 'Dictation is not set up on this Kinema server.' }),
      e => (e.status === 404 ? { ok: false, reason: 'Dictation is not set up on this Kinema server.' } : (statusPromise = null, { ok: false, reason: 'Could not reach Kinema to check dictation.', retry: true })));
  }
  return statusPromise;
}

/* The one primary composer button: mic when empty, stop while recording, working while finishing, send when there is a draft. */
export function actionMode({ pending, hasDraft, dictating, finishing }) {
  if (dictating) return finishing ? 'transcribing' : 'dictating';
  if (pending) return hasDraft ? 'send' : 'stop';
  return hasDraft ? 'send' : 'dictate';
}
export const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/></svg>';
export const ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/></svg>';

const localeLanguage = () => {
  const base = String(document.documentElement.lang || navigator.language || '').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(base) ? base : null;
};
const mappedCaret = (p, start, oldEnd, newEnd) => (p < start ? p : p >= oldEnd ? p + newEnd - oldEnd : newEnd);
function wav(parts, count, rate) {
  const bytes = new ArrayBuffer(44 + count * 2), v = new DataView(bytes);
  const t = (at, str) => { for (let i = 0; i < str.length; i++) v.setUint8(at + i, str.charCodeAt(i)); };
  t(0, 'RIFF'); v.setUint32(4, 36 + count * 2, true); t(8, 'WAVE'); t(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); t(36, 'data'); v.setUint32(40, count * 2, true);
  let at = 44; for (const part of parts) for (const x of part) { const n = Math.max(-1, Math.min(1, x)); v.setInt16(at, n < 0 ? n * 32768 : n * 32767, true); at += 2; }
  return new Blob([bytes], { type: 'audio/wav' });
}

/* Live draft dictation for one Kinema page (the Panel 196 design). One session at a time. A surface binds its textarea, optional
   secondary mic button, status line and identity(); a changed identity (thread, day, view) cancels the session and keeps the draft.
   Typing during dictation is kept; editing the dictated words cancels it. */
export class LiveDictation {
  constructor({ api, url, say }) {
    this.api = api; this.url = url; this.say = say || (() => {}); this.session = null; this.writing = false; this.s = null; this.avail = null;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.session) { e.preventDefault(); this.cancel(); } }, true);
    addEventListener('pagehide', () => this.cancel());
  }
  get active() { return !!this.session; }
  get finishing() { return !!this.session?.stopped; }
  /* surface = {box, button?, identity(), say(text), onState()} */
  bind(surface) {
    if (this.session && this.s && this.s.box !== surface.box) this.cancel(true);
    this.s = surface; const box = surface.box;
    if (!(this.boxes ||= new WeakSet()).has(box)) { this.boxes.add(box); box.addEventListener('input', () => { if (!this.writing && this.session && this.session.box === box) this.preserveEdit(this.session); }); }
    if (surface.button) surface.button.addEventListener('click', () => this.toggle());
    if (!this.avail) this.probe(); this.paint();
  }
  say_(t) { (this.s?.say || this.say)(t); }
  async probe(fresh = false) { this.avail = await dictationStatus(this.api, this.url, fresh); this.paint(); return this.avail; }
  get ready() { return !!this.avail?.ok; }
  get reason() { return this.avail ? this.avail.reason : 'Checking dictation…'; }
  identityNow() { return this.s?.identity?.() ?? ''; }
  valid(x) { return this.session === x && !x.cancelled && this.identityNow() === x.identity; }
  paint() {
    const b = this.s?.button;
    if (b) {
      const on = !!this.session, off = !on && !this.ready;
      b.classList.toggle('on', on && !this.session.stopped); b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('off', off); b.setAttribute('aria-disabled', String(off));
      b.dataset.state = on ? (this.session.stopped ? 'working' : 'listening') : off ? (this.avail ? 'unavailable' : 'checking') : 'idle';
      const label = on ? 'Stop dictation' : off ? this.reason : 'Add spoken text'; b.title = label; b.setAttribute('aria-label', label);
    }
    this.s?.onState?.();
  }
  status() { this.say_(this.session ? (this.session.stopped ? 'Finishing your words…' : 'Listening… press stop when you are ready to review') : ''); }
  render(x) {
    if (!this.valid(x)) return; const box = x.box;
    const words = [...x.texts.entries()].sort((a, b) => a[0] - b[0]).map(p => p[1]).filter(Boolean).join(' ');
    const spacer = words && x.rangeStart > 0 && !/\s/.test(box.value[x.rangeStart - 1] || '') ? ' ' : '';
    const next = spacer + words, previous = x.rendered; if (next === previous) return;
    let common = 0; while (common < previous.length && common < next.length && previous[common] === next[common]) common++;
    const start = x.rangeStart + common, oldEnd = x.rangeEnd, newEnd = start + next.length - common;
    const focused = document.activeElement === box, ss = box.selectionStart, se = box.selectionEnd, dir = box.selectionDirection, st = box.scrollTop;
    this.writing = true;
    box.setRangeText(next.slice(common), start, oldEnd, 'preserve');
    x.rendered = next; x.rangeEnd = newEnd; x.lastValue = box.value;
    box.dispatchEvent(new Event('input', { bubbles: true })); this.writing = false;
    if (focused) box.setSelectionRange(mappedCaret(ss, start, oldEnd, newEnd), mappedCaret(se, start, oldEnd, newEnd), dir);
    box.scrollTop = st;
  }
  preserveEdit(x) {
    const before = x.lastValue, after = x.box.value; if (before === after) return;
    let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let suffix = 0; while (suffix < before.length - start && suffix < after.length - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const oldEnd = before.length - suffix, change = after.length - before.length;
    if (oldEnd <= x.rangeStart) { x.rangeStart += change; x.rangeEnd += change; }
    else if (start < x.rangeEnd) { x.lastValue = after; this.cancel(); return; }
    x.lastValue = after;
  }
  queue(x, final = false) {
    if (!x.voiced || x.count < x.rate * .25) return;
    const item = { id: x.segment, revision: ++x.revision, final, blob: wav(x.parts, x.count, x.rate) };
    x.queue.set(x.segment, item); x.lastSnapshot = x.count;
    if (!x.pumping) x.pumping = this.pump(x).finally(() => { x.pumping = null; });
  }
  async decode(x, item) {
    const deadline = Date.now() + 60000;
    while (this.valid(x)) {
      const data = new FormData(); data.append('file', item.blob, 'dictation.wav'); data.append('live', '1'); data.append('final', item.final ? '1' : '0');
      if (x.language) data.append('language', x.language);
      const r = await fetch(this.url('/api/dictation/transcribe'), { method: 'POST', body: data, signal: x.abort.signal });
      if (r.status === 429 && Date.now() < deadline) { await new Promise(res => setTimeout(res, 1000)); continue; }
      let v = {}; try { v = await r.json(); } catch { /* not json */ }
      const msg = v.error || v.detail || '';
      if (r.status === 422 && x.language && !x.languageRejected && /unsupported dictation language/i.test(String(msg))) { x.language = null; x.languageRejected = true; continue; }
      if (!r.ok) throw Error(typeof msg === 'string' && msg ? msg : 'Dictation could not be transcribed.');
      const back = String(v.lang || '').trim().toLowerCase().split(/[-_]/)[0]; if (/^[a-z]{2,3}$/.test(back)) x.language = back;
      return v.text || '';
    }
    return '';
  }
  async pump(x) {
    while (this.valid(x) && x.queue.size) {
      const [id, item] = x.queue.entries().next().value; x.queue.delete(id);
      try { const text = await this.decode(x, item); if (!this.valid(x)) return; x.texts.set(id, text); this.render(x); }
      catch (e) { if (this.valid(x)) { x.failed = true; const m = e.name === 'AbortError' ? 'Dictation was interrupted. Your draft is kept.' : 'Dictation failed: ' + e.message + ' Your draft is kept.'; this.cancel(true); this.say_(m); } return; }
    }
  }
  boundary(x) { this.queue(x, true); x.segment++; x.parts = []; x.count = 0; x.lastSnapshot = 0; x.silent = 0; x.voiced = false; }
  capture(x, part) {
    if (!this.valid(x) || x.stopped || !(part instanceof Float32Array)) return;
    let e = 0; for (const v of part) e += v * v;
    const speech = Math.sqrt(e / part.length) > .009;
    x.parts.push(part); x.count += part.length;
    if (speech) { x.voiced = true; x.silent = 0; } else x.silent += part.length;
    if (x.count >= x.rate * 11.5 || (x.voiced && x.silent >= x.rate * .65)) this.boundary(x);
    else if (x.voiced && x.count - x.lastSnapshot >= x.rate * (x.lastSnapshot ? 1.2 : 1.0)) this.queue(x);
    else if (!x.voiced && x.count > x.rate * .5) { x.parts = x.parts.slice(-3); x.count = x.parts.reduce((n, p) => n + p.length, 0); }
    if (x.queue.size > 8) { this.say_('Dictation is catching up. Your recorded words are being finished.'); this.finish(); }
  }
  release(x) { clearInterval(x.guard); clearTimeout(x.limit); x.stream?.getTracks().forEach(t => t.stop()); x.node?.disconnect(); x.source?.disconnect(); x.audio?.close().catch(() => {}); }
  cancel(quiet = false) {
    const x = this.session; if (!x) return; this.session = null; x.cancelled = true; x.abort.abort(); this.release(x); x.queue.clear(); x.parts = [];
    this.paint(); this.say_(quiet ? '' : 'Dictation cancelled. Your draft is kept.');
  }
  async finish() {
    const x = this.session; if (!x) return true; if (x.finishing) return x.finishing;
    x.finishing = (async () => {
      if (x.node && !x.stopped) {
        const ok = await new Promise(res => { const t = setTimeout(() => res(false), 1500); x.flush = () => { clearTimeout(t); res(true); }; x.node.port.postMessage('flush'); });
        if (!ok && this.valid(x)) { this.cancel(true); this.say_('The last audio could not be finished. Your visible draft is kept.'); return false; }
      }
      if (!this.valid(x)) return false;
      this.queue(x, true); x.stopped = true; this.release(x); this.paint(); this.status();
      while (this.valid(x) && (x.pumping || x.queue.size)) { if (x.pumping) await x.pumping; else x.pumping = this.pump(x).finally(() => { x.pumping = null; }); }
      if (!this.valid(x)) return false;
      this.render(x); this.session = null; this.paint(); this.say_(x.rendered ? '' : 'Nothing was heard.'); return !x.failed;
    })().catch(e => { if (this.valid(x)) { this.cancel(true); this.say_(e.message || 'Dictation could not finish. Your draft is kept.'); } return false; });
    return x.finishing;
  }
  async toggle() {
    if (this.session) return this.finish();
    const surface = this.s; if (!surface) return;
    if (!this.ready) { const a = this.avail && !this.avail.retry ? this.avail : await this.probe(true); if (!a.ok) { this.say_(a.reason); return; } }
    const AC = window.AudioContext || window.webkitAudioContext, box = surface.box;
    if (!box || !navigator.mediaDevices?.getUserMedia || !AC) { this.say_('Microphone recording is unavailable in this browser.'); return; }
    const x = { box, identity: this.identityNow(), lastValue: box.value, rangeStart: box.value.length, rangeEnd: box.value.length, rendered: '', language: localeLanguage(), languageRejected: false,
      parts: [], count: 0, segment: 0, revision: 0, lastSnapshot: 0, silent: 0, voiced: false, queue: new Map(), texts: new Map(), abort: new AbortController(), stopped: false };
    this.session = x; this.say_('Starting microphone…'); this.paint();
    x.guard = setInterval(() => { if (!this.valid(x)) this.cancel(); }, 150);
    try {
      x.audio = new AC({ sampleRate: 48000 }); await x.audio.resume(); if (!this.valid(x)) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (!this.valid(x)) { stream.getTracks().forEach(t => t.stop()); return; }
      x.stream = stream; x.rate = x.audio.sampleRate;
      await x.audio.audioWorklet.addModule(WORKLET.href); if (!this.valid(x)) return;
      x.node = new AudioWorkletNode(x.audio, 'panel-dictation-capture');
      x.node.port.onmessage = e => { if (e.data === 'flushed') { x.flush?.(); return; } this.capture(x, e.data); };
      x.node.onprocessorerror = () => { if (this.valid(x)) { this.cancel(true); this.say_('Microphone capture stopped. Your draft is kept.'); } };
      x.source = x.audio.createMediaStreamSource(stream); x.source.connect(x.node); x.node.connect(x.audio.destination);
      x.limit = setTimeout(() => this.finish(), MAX_MS); this.paint(); this.status(); box.focus({ preventScroll: true });
    } catch (e) {
      if (this.valid(x)) { this.cancel(true); this.say_(e.name === 'NotAllowedError' ? 'Microphone access was not allowed.' : e.name === 'NotFoundError' ? 'No microphone was found.' : 'The microphone could not start: ' + (e.message || e.name)); }
    }
  }
}
