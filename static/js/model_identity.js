import { esc } from './md.js';

// Every assistant turn, live or saved, wears the same small companion, so a pending reply and its
// finished version look the same. Keep model attribution on each saved/launched turn; never borrow the composer's current selection.
export const assistantMark = `<span class="kn-mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 12.5C3 6.8 6.4 3 12 3s9 3.8 9 9.5v5.2c0 2.4-1.7 3.3-3.3 1.8-.6-.6-1.1-.6-1.7 0-1.2 1.3-2.3 1.3-3.5 0-.6-.6-1.1-.6-1.7 0-1.2 1.3-2.3 1.3-3.5 0-.6-.6-1.1-.6-1.7 0C4.2 20.9 3 20 3 17.7Z"/><g fill="#1b1d21"><ellipse cx="8.5" cy="11.2" rx="1.05" ry="1.5"/><ellipse cx="15.5" cy="11.2" rx="1.05" ry="1.5"/></g><path d="M10.3 15c1.1.9 2.3.9 3.4 0" fill="none" stroke="#1b1d21" stroke-width="1.1" stroke-linecap="round"/></svg></span>`;
const catalogNames = new Map();
export function setModelCatalog(models = []) {
  for (const model of models) if (model?.id && typeof model.label === 'string' && model.label.trim()) catalogNames.set(model.id, model.label.trim());
}
export function modelName(id, fallback = 'Model not recorded') {
  if (!id) return fallback;
  const tag = String(id).replace(/^(codex|claude|local):/, ''), named = catalogNames.get(id);
  // a catalog label that only repeats the raw id ("haiku") is no name; the readable one below wins
  if (named && named.toLowerCase() !== tag.toLowerCase() && named.toLowerCase() !== String(id).toLowerCase()) return named;
  const aliases = {opus:'Claude Opus 5.5',sonnet:'Claude Sonnet 5.5',haiku:'Claude Haiku 5.5',fable:'Claude Fable 5.1','fable-5.1':'Claude Fable 5.1'};
  if (aliases[tag]) return aliases[tag];
  const c = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:(?:[.-](\d{1,2}))(?:-\d{8})?|-(?:\d{8}))?$/.exec(tag);
  if (c) return `Claude ${c[1][0].toUpperCase()+c[1].slice(1)} ${c[2]}${c[3] ? '.'+c[3] : ''}`;
  const g = /^gpt-(\d[\w.]*)((?:-[a-z][a-z0-9]*)*)$/i.exec(tag);
  if (g) return 'GPT-'+g[1]+g[2].split('-').filter(Boolean).map(w=>' '+w[0].toUpperCase()+w.slice(1)).join('');
  return String(id);
}
export function effortLabel(raw, model = '') {
  if (!raw) return '';
  const k = String(raw).toLowerCase(), tag = model.replace(/^(codex|claude|local):/, '');
  if (k === 'low' && ['gpt-6-astra','gpt-6-sol','gpt-6.1-sol','gpt-5.6-sol'].includes(tag)) return 'Light';
  return ({default:'Default',none:'None',minimal:'Minimal',low:'Low',medium:'Medium',med:'Medium',high:'High',xhigh:'Extra High',max:'Max',ultra:'Ultra'})[k] || raw;
}
export function byline(turn = {}, pending = false) {
  const name = typeof turn.model_label === 'string' && turn.model_label.trim() ? turn.model_label.trim() : modelName(turn.model, pending ? 'Kinema' : ['opening','problem','visual'].includes(turn.kind) ? 'Kinema' : 'Model not recorded');
  const effort = turn.model && effortLabel(turn.effort, turn.model);
  const label = name + (effort ? ' · '+effort : '');
  return `<span class="aava" aria-hidden="true">${assistantMark}</span><b>${esc(label)}</b>`;
}
