import { controlIcon } from './icons.js';
import { esc, math } from './md.js';

/* Folders contain references. Their controls never delete original questions or work. */
export class LibraryFolders {
  constructor(teacher, deps) {
    this.t = teacher; this.d = deps; teacher.libraryFolders = this; this.seq = 0; this.dialogSeq = 0;
    try { this.id = sessionStorage.getItem('kinema.library.folder') || null; } catch { }
    teacher.host.addEventListener('click', e => { const b = e.target.closest('[data-folder-action]'); if (b) { e.preventDefault(); this.click(b); } });
    teacher.host.addEventListener('submit', e => { if (e.target.matches('[data-folder-form]')) { e.preventDefault(); this.submit(e.target); } });
  }
  request(path = '', method = 'GET', body) {
    return this.t.d.api(this.t.d.url('/api/library/folders' + path), { method, ...(body === undefined ? {} : { headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }) });
  }
  select(id) { this.id = id || null; try { if (id) sessionStorage.setItem('kinema.library.folder',id); else sessionStorage.removeItem('kinema.library.folder'); } catch { } }
  active() { return this.t.page === 'library' && !!this.host?.getClientRects().length; }
  statusHeading(id) {
    const name = id ? (this.data?.id === id ? this.data.name : 'Folder') : 'Folders';
    return `${id ? `<button type="button" class="tv-book-back" data-folder-action="list">${controlIcon('left')} Folders</button>` : ''}<div class="folder-heading"><h2>${esc(name)}</h2></div>`;
  }
  async enter() {
    this.host = this.t.host.querySelector('#libfolders');
    const restore = this.restore; this.restore = null; if (restore) this.select(restore.folder_id);
    const seq = ++this.seq, id = this.id; this.host.innerHTML = this.statusHeading(id) + '<p class="pg-note" role="status">Loading folders…</p>';
    try {
      const data = await this.request(id ? '/' + encodeURIComponent(id) : '');
      if (seq !== this.seq || !this.active()) return;
      this.data = data; this.render();
      if (restore) requestAnimationFrame(() => { if (seq === this.seq && this.active()) this.t.el.page.scrollTop = Number(restore.scroll) || 0; });
    } catch (e) {
      if (seq !== this.seq || !this.active()) return;
      this.host.innerHTML = `${this.statusHeading(id)}<p class="folder-error" role="alert">${esc(e.message)}</p><button type="button" class="folder-button" data-folder-action="retry">Try again</button>`;
    }
  }
  render() {
    const folder = this.id && this.data;
    if (!folder) this.host.innerHTML = `<div class="folder-heading"><h2>Folders</h2><button type="button" class="folder-button" data-folder-action="create">New folder</button></div>
      ${(this.data?.items || []).length ? `<ul class="folder-list">${this.data.items.map(f => `<li><button type="button" data-folder-action="folder" data-folder-id="${esc(f.id)}"><svg class="folder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/></svg><span><b>${esc(f.name)}</b><small>${f.count} ${f.count === 1 ? 'problem' : 'problems'}</small></span></button></li>`).join('')}</ul>` : '<p class="folder-empty">Create a folder for a homework set. Add questions from the book.</p>'}`;
    else this.host.innerHTML = `<button type="button" class="tv-book-back" data-folder-action="list">${controlIcon('left')} Folders</button><div class="folder-heading"><div><h2>${esc(folder.name)}</h2><p>${folder.count} ${folder.count === 1 ? 'problem' : 'problems'}</p></div><div class="folder-heading-actions"><button type="button" data-folder-action="rename">Rename</button><button type="button" data-folder-action="delete">Delete folder</button></div></div>
      ${(folder.items || []).length ? `<ul class="folder-items">${folder.items.map((item,i) => `<li><button type="button" class="folder-item-open" data-folder-action="item" data-index="${i}"${item.available ? '' : ' disabled'}><span class="folder-item-number">${esc(item.number || (item.kind === 'chat' ? 'Chat' : 'Saved'))}</span><span>${esc(item.title)}${item.available ? '' : '<small>Original unavailable</small>'}</span><i aria-hidden="true">${item.available ? '↗' : ''}</i></button><button type="button" class="folder-remove" data-folder-action="remove" data-index="${i}" aria-label="Remove ${esc(item.number || item.title)} from this folder" title="Remove from folder">×</button></li>`).join('')}</ul>` : '<p class="folder-empty">This folder is empty. Open a question and choose Add to folder.</p>'}`;
    math(this.host);
  }
  origin() { return { chapter: 'folder', folder_id: this.id, scroll: this.t.el.page.scrollTop }; }
  openReturn(origin) { this.d.openFolder(origin.folder_id, origin.scroll); }
  rememberThread(id, origin) { try { sessionStorage.setItem('kinema.book.return.' + id, JSON.stringify(origin)); } catch { } if(this.t.thread?.id===id) this.syncReturn(); }
  savedReturn(id) { try { return JSON.parse(sessionStorage.getItem('kinema.library.saved.return.' + id)); } catch { return null; } }
  clearSavedReturn(id) { try { sessionStorage.removeItem('kinema.library.saved.return.' + id); } catch { } }
  clearThreadReturn(id) { try { const key='kinema.book.return.'+id, origin=JSON.parse(sessionStorage.getItem(key)); if(origin?.chapter==='folder') sessionStorage.removeItem(key); } catch { } if(this.t.thread?.id===id) this.syncReturn(); }
  syncReturn() { this.t.el.stream.querySelector('.tv-folder-return')?.remove(); if(this.t.thread) this.t.el.stream.insertAdjacentHTML('afterbegin',this.returnHTML(this.t.thread)); this.t.book.setBackLabel(); }
  returnHTML(thread) {
    const origin = this.t.book.origin();
    return !thread.book_problem && origin?.chapter === 'folder' ? `<button type="button" class="tv-book-back tv-folder-return" data-folder-action="return">${controlIcon('left')} Back to folder</button>` : '';
  }
  async open(item) {
    if (!item?.available) return;
    const origin = this.origin();
    if (item.kind === 'book') return this.t.book.open(item.id, null, origin);
    if (item.kind === 'chat') { this.rememberThread(item.thread_id, origin); this.t.leaveViews(); return this.t.openThread(item.thread_id); }
    try { sessionStorage.setItem('kinema.library.saved.return.' + item.id, JSON.stringify(origin)); } catch { }
    this.d.openSaved(item.id);
  }
  refreshVisible() { if (this.active()) { this.restore = { folder_id:this.id, scroll:this.t.el.page.scrollTop }; this.enter(); } }
  modalLive(ctx) { return this.modal === ctx && this.t.el.dialog.open && this.t.el.dialog.querySelector('[data-folder-dialog]')?.dataset.folderDialog === String(ctx.ticket); }
  modalHTML(ctx, body) { this.t.dialog(ctx.title, `<div data-folder-dialog="${ctx.ticket}" class="folder-dialog">${body}</div>`); math(this.t.el.dialog); }
  newModal(mode, title, extra = {}) { const ctx = this.modal = { mode, title, ticket:++this.dialogSeq, ...extra }; this.modalHTML(ctx,'<p class="pg-note" role="status">Loading folders…</p>'); return ctx; }
  form(ctx, label, submit, value = '') {
    return `<form data-folder-form><label>${label}<input name="folder-name" maxlength="80" value="${esc(value)}" placeholder="Homework 3" autocomplete="off" required></label><p class="folder-error" role="alert" hidden></p><div class="folder-form-actions"><button type="submit" class="folder-button">${submit}</button></div></form>`;
  }
  edit(mode) {
    const folder = this.id && this.data, ctx = this.newModal(mode, mode === 'create' ? 'New folder' : mode === 'rename' ? 'Rename folder' : 'Delete folder', {folder});
    if (mode === 'delete') this.modalHTML(ctx, `<p>Delete <strong>${esc(folder.name)}</strong>? The original problems and chats stay in your Library.</p><form data-folder-form><p class="folder-error" role="alert" hidden></p><div class="folder-form-actions"><button type="button" class="folder-button" data-folder-action="cancel">Cancel</button><button type="submit" class="folder-button">Delete folder</button></div></form>`);
    else this.modalHTML(ctx, this.form(ctx,'Folder name',mode === 'create' ? 'Create folder' : 'Save name',folder && mode === 'rename' ? folder.name : ''));
    this.t.el.dialog.querySelector('input')?.focus();
  }
  async choose(item) {
    const ctx = this.newModal('choose', 'Add to folder', {item});
    try {
      const data = await this.request(); if (!this.modalLive(ctx)) return;
      this.modalHTML(ctx, `<p class="folder-choice-item">${esc(item.title || (item.kind === 'book' ? 'Morin ' + item.id : 'Selected problem'))}</p><div class="folder-choices">${data.items.map(f => `<button type="button" data-folder-action="choose" data-folder-id="${esc(f.id)}"><span>${esc(f.name)}</span><small>${f.count}</small></button>`).join('') || '<p class="pg-note">No folders yet.</p>'}</div><p class="folder-error" data-choice-error role="alert" hidden></p>${this.form(ctx,'New folder','Create & add')}`);
    } catch(e) { if(this.modalLive(ctx)) this.modalHTML(ctx, `<p class="folder-error" role="alert">${esc(e.message)}</p><button type="button" class="folder-button" data-folder-action="choose-retry">Try again</button>`); }
  }
  error(form, message) { const box = form.querySelector('.folder-error'); if (box) { box.textContent = message; box.hidden = false; } }
  async add(ctx, id) {
    await this.request('/' + encodeURIComponent(id) + '/items','POST',{kind:ctx.item.kind,id:ctx.item.id});
    if (this.modalLive(ctx)) { this.t.el.dialog.close(); this.t.d.toast('Added to folder'); }
    this.refreshVisible();
  }
  async submit(form) {
    const ctx = this.modal; if (!this.modalLive(ctx) || ctx.busy) return;
    const name = form.elements.namedItem('folder-name')?.value;
    ctx.busy = true; form.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      if (ctx.mode === 'choose') {
        const folder = ctx.created || await this.request('','POST',{name}); ctx.created = folder;
        const input=form.elements.namedItem('folder-name'); if(input) { input.value=folder.name; input.disabled=true; }
        form.querySelector('[type=submit]').textContent='Add to this folder';
        await this.add(ctx,folder.id);
      }
      else if (ctx.mode === 'create') { const folder = await this.request('','POST',{name}); if (this.modalLive(ctx)) { this.t.el.dialog.close(); this.select(folder.id); this.enter(); } }
      else if (ctx.mode === 'rename') { await this.request('/'+encodeURIComponent(ctx.folder.id),'PATCH',{name}); if (this.modalLive(ctx)) this.t.el.dialog.close(); this.refreshVisible(); }
      else if (ctx.mode === 'delete') { await this.request('/'+encodeURIComponent(ctx.folder.id),'DELETE'); if (this.modalLive(ctx)) this.t.el.dialog.close(); if (this.id === ctx.folder.id) this.select(null); this.refreshVisible(); }
    } catch(e) { if (this.modalLive(ctx)) this.error(form,e.message); }
    finally { ctx.busy = false; if(form.isConnected) form.querySelectorAll('button').forEach(b => b.disabled = false); }
  }
  async click(b) {
    const action = b.dataset.folderAction;
    if (action === 'add') return this.choose({kind:b.dataset.folderKind,id:b.dataset.folderId,title:b.dataset.folderTitle});
    if (action === 'folder') { this.select(b.dataset.folderId); return this.enter(); }
    if (action === 'list') { this.select(null); return this.enter(); }
    if (action === 'retry') return this.enter();
    if (action === 'return') return this.openReturn(this.t.book.origin());
    if (['create','rename','delete'].includes(action)) return this.edit(action);
    if (action === 'cancel') return this.t.el.dialog.close();
    if (action === 'choose-retry') return this.choose(this.modal.item);
    if (action === 'choose') {
      const ctx = this.modal; if(!this.modalLive(ctx) || ctx.busy) return; ctx.busy = true; b.disabled = true;
      try { await this.add(ctx,b.dataset.folderId); } catch(e) { if (this.modalLive(ctx)) { const error = this.t.el.dialog.querySelector('[data-choice-error]'); error.textContent=e.message; error.hidden=false; } }
      finally { ctx.busy=false; b.disabled=false; } return;
    }
    const item = this.data?.items?.[Number(b.dataset.index)]; if (!item) return;
    if (action === 'item') return this.open(item);
    if (action === 'remove') {
      b.disabled = true; const id=this.id;
      try { const detail=await this.request('/'+encodeURIComponent(id)+'/items/'+item.kind+'/'+encodeURIComponent(item.id),'DELETE'); if(this.active()&&this.id===id){this.data=detail;this.render();} }
      catch(e) { this.t.d.toast('Could not remove from folder: '+e.message); b.disabled=false; }
    }
  }
}
