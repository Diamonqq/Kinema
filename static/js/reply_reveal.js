/* Smooth delivery of streamed reply text, ported from Panel's chat (panel-chat.js presentText): a received burst is revealed at a
   readable pace (100-600 ms), always appends, never repaints backwards, and is shown whole when the tab is hidden, the reader
   prefers reduced motion, the node is gone, or the text is final. Used by the tutor chat and Daily. */
const views = new WeakMap(), pending = new Set();
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function flushText(node) {
  const view = node && views.get(node); if (!view) return;
  if (view.frame) cancelAnimationFrame(view.frame); view.frame = 0; pending.delete(view);
  if (!view.painted || view.shown !== view.target) { view.shown = view.target; view.painted = true; view.paint(view.shown); }
}
/* paint(text) receives the text to show now; animate=false (or force) shows it whole. */
export function presentText(node, text, paint, { animate = true, force = false } = {}) {
  text = String(text ?? ''); let view = views.get(node);
  if (!view) { view = { node, shown: '', target: '', paint, frame: 0, painted: false }; views.set(node, view); }
  const append = text.startsWith(view.target), unchanged = text === view.target;
  view.paint = paint; view.target = text;
  if (force || !animate || !append || document.hidden || reduced?.matches || !node.isConnected) { flushText(node); return; }
  if (view.shown === text || (unchanged && view.frame)) return;
  view.from = view.shown.length; view.started = performance.now();
  view.duration = Math.min(600, Math.max(100, (text.length - view.from) * 4)); view.deadline = view.started + view.duration;
  if (view.frame) return;
  pending.add(view);
  const step = now => {
    view.frame = 0;
    if (document.hidden || reduced?.matches || !node.isConnected || now >= view.deadline) { flushText(node); return; }
    const f = Math.max(0, Math.min(1, (now - view.started) / view.duration));
    let end = Math.max(view.shown.length, view.from + Math.ceil((view.target.length - view.from) * f));
    if (end < view.target.length && /[\uD800-\uDBFF]/.test(view.target[end - 1] || '')) end++;     // never split a surrogate pair
    const shown = view.target.slice(0, end);
    if (shown !== view.shown) { view.shown = shown; view.painted = true; view.paint(shown); }
    view.frame = requestAnimationFrame(step);
  };
  view.frame = requestAnimationFrame(step);
}
export function forget(node) { const v = views.get(node); if (v) { if (v.frame) cancelAnimationFrame(v.frame); pending.delete(v); views.delete(node); } }
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const v of [...pending]) flushText(v.node); });
reduced?.addEventListener?.('change', () => { if (reduced.matches) for (const v of [...pending]) flushText(v.node); });
