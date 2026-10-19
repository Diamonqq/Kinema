/* Compact attachment tiles with real upload progress, shared by the tutor chat and Daily. Plain data in, markup out:
   a file is {key, name, kind, preview?, url?, id?, error?, progress?} — progress is 0..1 while uploading, id appears when stored. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

export function tileHTML(f, url) {
  const state = f.error ? 'error' : f.id ? 'done' : 'busy';
  const pct = state === 'busy' ? Math.max(0, Math.min(100, Math.round((f.progress || 0) * 100))) : state === 'done' ? 100 : 0;
  const src = f.preview || (f.kind === 'image' && f.url ? url(f.url) : '');
  const label = state === 'error' ? f.error : state === 'busy' ? (pct >= 100 ? 'Processing…' : `Uploading ${pct}%`) : f.kind === 'pdf' ? 'PDF' : f.kind === 'image' ? 'Image' : 'File';
  const ext = (f.kind || 'file').slice(0, 4).toUpperCase();
  const thumb = src ? `<img src="${esc(src)}" alt="">` : `<i class="at-ext">${esc(ext)}</i>`;
  return `<span class="at-tile at-${state}${src ? ' at-image' : ' at-file'}" data-key="${esc(f.key)}" role="group" aria-label="${esc(f.name)}: ${esc(label)}" title="${esc(state === 'error' ? f.name + ' — ' + f.error : f.name)}">
    ${thumb}<span class="at-copy"><strong>${esc(f.name)}</strong><small${state === 'error' ? ' role="alert"' : ''}>${esc(label)}</small></span>
    ${state === 'error' && f.file ? `<button type="button" class="at-retry" data-act="retry-upload" data-key="${esc(f.key)}">Retry</button>` : ''}
    ${state === 'busy' ? `<span class="at-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><b style="width:${pct}%"></b></span>` : ''}
    <button type="button" class="at-x" data-act="unattach" data-key="${esc(f.key)}" aria-label="Remove ${esc(f.name)}" title="Remove">${X}</button></span>`;
}

/* In-place progress update so a tile does not re-render (and flash) on every XHR progress event. */
export function paintProgress(host, f) {
  const t = host?.querySelector?.(`.at-tile[data-key="${CSS.escape(f.key)}"]`); if (!t) return false;
  const pct = Math.max(0, Math.min(100, Math.round((f.progress || 0) * 100)));
  const b = t.querySelector('.at-bar b'); if (b) b.style.width = pct + '%';
  t.querySelector('.at-bar')?.setAttribute('aria-valuenow', String(pct));
  const s = t.querySelector('small'); if (s) s.textContent = pct >= 100 ? 'Processing…' : `Uploading ${pct}%`;
  return true;
}

/* multipart upload with progress. resolves the parsed JSON; rejects with .message from the server's {detail|error}. */
export function upload(url, form, { onProgress, signal, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', url); x.timeout = timeout; x.responseType = 'text';
    x.upload.onprogress = e => { if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total); };
    x.onload = () => {
      let body = null; try { body = JSON.parse(x.responseText); } catch { /* not json */ }
      if (x.status >= 200 && x.status < 300) return resolve(body || {});
      const d = body?.detail ?? body?.error, msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map(i => i.msg).join('; ') : '';
      reject(Object.assign(new Error(msg || (x.status === 413 ? 'The file is too large' : `The upload failed (${x.status})`)), { status: x.status, body }));
    };
    x.onerror = () => reject(new Error('No connection — the upload did not finish'));
    x.ontimeout = () => reject(new Error('The upload took too long'));
    x.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }));
    signal?.addEventListener('abort', () => x.abort(), { once: true });
    x.send(form);
  });
}

/* The 200 ms send/settle motion shared by both composers: a delivered bubble settles in once. Honours reduced motion. */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function settleIn(node) {
  if (!node || reducedMotion() || !node.animate) return;
  node.animate([{ opacity: 0, transform: 'translateY(8px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.7,.2,1)' });
}
