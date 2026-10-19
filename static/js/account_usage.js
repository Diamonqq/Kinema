import { esc } from './md.js';

// Plan usage of the one signed-in account, as the official CLI reports it.
// Cached for a minute; the server refreshes in the background and never calls a model.
let cached = null, at = 0, pending = null, epoch=0;
export function resetUsageCache(){cached=null;at=0;pending=null;epoch++}

export async function loadUsage(api, url, force = false) {
  if (!force && cached && Date.now() - at < 60000) return cached;
  if (pending) return pending;
  const run=epoch;const request = api(url('/api/connections/usage')).then(data => {
    if(run!==epoch)return data;
    cached = data; at = Date.now();
    if (data?.refreshing) setTimeout(() => { at = 0; }, 3000); // Read again once the background check lands.
    return data;
  }).finally(() => { if(pending===request)pending=null; });
  pending=request;return request;
}

export const usageCached = () => cached;

// Panel's wording: a window ending soon reads "in 1h 26m"; later resets read "Sat 4 AM" (minutes only when set).
function resetText(seconds) {
  if (!seconds) return '';
  const when = new Date(seconds * 1000), now = new Date(), ms = when - now;
  if (ms < 0) return '';
  if (ms < 6 * 3600000) {
    const mins = Math.max(1, Math.round(ms / 60000)), h = Math.floor(mins / 60), m = mins % 60;
    return 'in ' + (h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm');
  }
  const time = when.toLocaleTimeString(undefined, {hour:'numeric', minute: when.getMinutes() ? '2-digit' : undefined});
  return when.toDateString() === now.toDateString() ? time : when.toLocaleDateString(undefined, {weekday:'short'}) + ' ' + time;
}

/** Slim bars: "42% of 5h limit · resets 3:10 PM". Empty when nothing is reported. */
export function usageHTML(usage, {compact = false, remaining = false} = {}) {
  // A window that has already reset says nothing about now, so it is left out.
  const windows = (usage?.windows || []).filter(w => typeof w?.used_percent === 'number' && !(w.resets_at && w.resets_at * 1000 < Date.now()));
  if (!windows.length) return '';
  const rows = windows.map(w => {
    const used = Math.max(0, Math.min(100, w.used_percent)), reset = resetText(w.resets_at);
    const tone = used >= 90 ? 'is-high' : used >= 70 ? 'is-mid' : '';
    const label = String(w.label || '').replace(/^(5-hour|5h) limit$/i,'Session limit').replace(/^Weekly · all models$/i,'Weekly'), amount=remaining?100-used:used, text = remaining?`${Math.round(amount*10)/10}% left`:`${Math.round(used)}% of ${label}`;
    return `<div class="ku-row"><div class="ku-line"><span>${remaining?esc(label):esc(text)}</span>${remaining?`<strong>${esc(text)}</strong>`:''}${reset ? `<small>resets ${esc(reset)}</small>` : ''}</div><div class="ku-bar ${tone}" role="meter" aria-label="${esc(text)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${amount}"><i style="width:${amount}%"></i></div></div>`;
  }).join('');
  const stale = usage.checked_at && Date.now() / 1000 - usage.checked_at > 6 * 3600;
  return `<div class="ku-usage${compact ? ' is-compact' : ''}">${rows}${stale ? '<small class="ku-stale">Last reading</small>' : ''}</div>`;
}
