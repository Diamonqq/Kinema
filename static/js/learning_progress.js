import { controlIcon } from './icons.js';
import { esc, mdlite, math } from './md.js';

const states = { not_checked: 'Not yet measured', seen: 'Seen, not checked', gap: 'Needs work', learning: 'Learning', confirmed: 'Confirmed', mastered: 'Mastered' };
const date = ts => ts ? new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No check yet';
export const conceptSections = ch => (ch.groups || []).flatMap(g => g.sections || []).filter(s => s.kind === 'concept');
export function sectionComplete(s) {
  const p = s.progress, skills = s.skills || [];
  return !!(p?.complete && p.coverage_complete && skills.length && p.total_skills === skills.length && skills.every(k => ['confirmed', 'mastered'].includes(k.state)));
}
export function chapterComplete(ch) {
  const sections = conceptSections(ch);
  return !!(ch.progress?.complete && sections.length && sections.every(sectionComplete));
}
export function progressBadge(row, chapter = false) {
  const done = chapter ? chapterComplete(row) : sectionComplete(row);
  const due = row.progress?.due ? '<span class="lp-due">Review due</span>' : '';
  return `${done ? '<span class="lp-complete">✓ Checked</span>' : ''}${due}`;
}
export function problemStarters(p) {
  if (p?.prepared_help?.interaction === 'conceptual' || p?.id === '10.1') return [
    { label: 'Check my reasoning', text: `Check my reasoning about problem ${p.id}: ` },
    { label: 'Compare definitions', text: `Help me distinguish the physical definitions in problem ${p.id}, one at a time.` },
    { label: 'Explain the idea', text: `Explain the physical idea behind problem ${p.id} with a simple example.` }];
  return [{ label: 'First principle', text: `Which physical principle fits problem ${p.id}, and why?` },
    { label: 'Check my attempt', text: `Check my attempt at problem ${p.id}: ` },
    { label: 'One small hint', text: `Give me one small hint for problem ${p.id}, without solving it.` }];
}

export function supportOverview(chapters) {
  const unique=new Map();for(const ch of chapters||[])for(const sec of conceptSections(ch))for(const k of sec.skills||[])unique.set(k.id,k);
  const skills=[...unique.values()];return {total:skills.length,checked:skills.filter(k=>(k.support?.checks||0)>0).length,
    supported:skills.filter(k=>['confirmed','mastered'].includes(k.state)&&!k.due).length,
    recheck:skills.filter(k=>k.due||k.state==='gap').length,observed:skills.filter(k=>(k.support?.tutor_observations||0)>0).length};
}
function supportHTML(k) {
 const s=k.support||k.state?.support||{};
 return `<p class="lp-confidence"><b>Evidence: ${esc(k.evidence_strength||'Not yet measured')}</b><br>${s.checks?`${s.unhinted_correct||0} unhinted correct out of ${s.checks} recorded checks · last check ${esc(date(s.last_check))}`:'No independent checks recorded.'}${s.tutor_observations?`<br>${s.tutor_observations} tutor observation${s.tutor_observations===1?'':'s'} · tentative`:''}</p>`;
}
function evidenceHTML(rows, tutor=false) {
 return rows.length?`<ol class="lp-evidence">${rows.map(e=>`<li><time>${esc(date(e.ts))}</time><span>${esc(tutor?e.kind==='taught'?'Discussed with the tutor':'Tutor-assessed work with help':({correct:'Unhinted answer correct',correct_hint:'Correct with help',wrong:'Answer missed',dont_know:'Did not know yet',exposure:'Read or taught',revealed:'Answer revealed'})[e.outcome]||e.outcome||e.kind)}${!tutor&&e.ref?`<small class="lp-ref"> · ${esc(e.ref)}</small>`:''}</span>${e.detail?.reason?`<blockquote>${esc(e.detail.reason)}</blockquote>`:e.detail?.note?`<p>${esc(e.detail.note)}</p>`:''}</li>`).join('')}</ol>`:'<p class="lp-muted">Nothing recorded yet.</p>';
}

// This view only reads evidence and submits explicit diagnostic answers. Reading never records exposure.
export class LearningProgress {
  constructor({ api, url, onChange }) { Object.assign(this, { api, url, onChange }); this.seq = 0; this.mapSeq = 0; this.openCh = new Set(); this.openSec = new Set(); }
  mount(host) {
    this.host = host;
    host.onclick = e => { const b = e.target.closest('[data-lp]'); if (b) this.click(b.dataset); };
    host.addEventListener('toggle', e => { const d = e.target; const set = d.dataset.lpChapter != null ? this.openCh : d.dataset.lpSection != null ? this.openSec : null; const key = d.dataset.lpChapter ?? d.dataset.lpSection; if (set) d.open ? set.add(key) : set.delete(key); }, true);
    this.paint();
    if (!this.map && !this.loading && !this.error && !this.cancelled) this.load();
  }
  leave() { ++this.seq; this.loading = false; this.busy = false; this.check = null; this.skill = null; this.skillId = null; this.q = null; this.submission = null; this.answer = null; this.error = null; this.cancelled = false; }
  async load({ reveal = false } = {}) {
    const seq = ++this.seq, mapSeq = ++this.mapSeq; this.cancelled = false; this.loading = true; this.error = null; this.paint({ reveal });
    try { const r = await this.api(this.url('/api/chapter-map')); if (seq !== this.seq || mapSeq !== this.mapSeq) return; this.map = r; this.onChange?.(r); }
    catch (e) { if (seq === this.seq) this.error = e.message || 'Could not load progress.'; }
    finally { if (seq === this.seq) { this.loading = false; this.paint({ reveal }); } }
  }
  sections() { return (this.map?.chapters || []).flatMap(conceptSections); }
  async drill(id) {
    const seq = ++this.seq; this.cancelled = false; this.skillId = id; this.skill = null; this.check = null; this.loading = true; this.error = null; this.paint({ reveal: true });
    try { const r = await this.api(this.url('/api/skills/' + encodeURIComponent(id))); if (seq === this.seq) this.skill = r; }
    catch (e) { if (seq === this.seq) this.error = e.message || 'Could not load this skill.'; }
    finally { if (seq === this.seq) { this.loading = false; this.paint({ reveal: true }); } }
  }
  async start(ids, label) {
    if (this.busy || !ids.length) return;
    this.cancelled = false; this.finished = null; this.skillId = null; this.skill = null; this.check = { ids, label, index: 0 }; await this.question();
  }
  async question() {
    const seq = ++this.seq, c = this.check; if (!c) return;
    this.loading = true; this.error = null; this.q = null; this.answer = null; this.submission = null; this.paint({ reveal: true });
    try {
      const r = await this.api(this.url('/api/skills/' + encodeURIComponent(c.ids[c.index]) + '/question'));
      if (seq === this.seq) { this.q = r; this.dedup = 'progress-' + crypto.randomUUID(); }
    } catch (e) { if (seq === this.seq) this.error = e.message || 'Could not load this check.'; }
    finally { if (seq === this.seq) { this.loading = false; this.paint({ reveal: true }); } }
  }
  async submit(picked) {
    if (this.busy || this.answer || !this.q) return;
    const seq = this.seq, q = this.q;
    // Freeze the exact payload across an uncertain response; retry cannot record a different answer.
    this.submission ||= { picked: picked < 0 ? null : picked, dont_know: picked < 0, order: q.order, hinted: false, source: 'session', dedup: this.dedup };
    this.busy = true; this.error = null; this.paint();
    try {
      const r = await this.api(this.url('/api/questions/' + encodeURIComponent(q.question_id) + '/answer'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.submission) });
      // Refresh the shared Study badges even if this view was closed during submission.
      const mapSeq = ++this.mapSeq;
      try { const map = await this.api(this.url('/api/chapter-map')); if (mapSeq === this.mapSeq) { this.map = map; this.onChange?.(map); } } catch { if (mapSeq === this.mapSeq) this.refreshError = true; }
      if (seq === this.seq) this.answer = r;
    } catch (e) { if (seq === this.seq) this.error = e.message || 'Could not save this answer.'; }
    finally { if (seq === this.seq) { this.busy = false; this.paint({ reveal: true }); } }
  }
  click(d) {
    if (d.lp === 'cancel') { this.leave(); this.skillId = null; this.q = null; this.cancelled = true; this.paint({ reveal: true }); }
    if (d.lp === 'back') { this.leave(); this.q = null; this.skillId = null; this.finished = null; this.load({ reveal: true }); }
    if (d.lp === 'refresh') { this.refreshError = false; this.load({ reveal: true }); }
    if (d.lp === 'skill') this.drill(d.id);
    if (d.lp === 'section-check') { const s = this.sections().find(s => s.id === d.id); const ids = (s?.skills || []).filter(k => k.question_count > 0).map(k => k.id); if (ids.length) this.start(ids, s.id + ' · ' + s.title); }
    if (d.lp === 'skill-check') this.start([d.id], this.skill?.title || d.id);
    if (d.lp === 'pick') this.submit(Number(d.pick));
    if (d.lp === 'retry-answer') this.submit(this.submission?.picked ?? -1);
    if (d.lp === 'retry') this.check ? this.question() : this.skillId ? this.drill(this.skillId) : this.load({ reveal: true });
    if (d.lp === 'next' && this.answer) { if (++this.check.index < this.check.ids.length) this.question(); else { this.finished = this.check.label; this.check = null; this.q = null; this.answer = null; this.paint({ reveal: true }); } }
  }
  skillHTML() {
    const k=this.skill, evidence=k.evidence||[], observations=evidence.filter(e=>e.source==='chat'), checks=evidence.filter(e=>e.source!=='chat');
    return `<h3>${esc(k.title)}</h3><p class="lp-state">${esc(states[k.state?.state]||'Not yet measured')}${k.state?.due?' · Review due':''}</p>${supportHTML(k)}<p class="lp-muted">${esc(k.reason||'No independent check recorded.')}</p><div class="mdb">${mdlite(k.task||'')}</div>
      ${k.questions?`<button data-lp="skill-check" data-id="${esc(k.id)}">Check this skill</button>`:'<p class="lp-muted">No authored diagnostic for this skill yet.</p>'}
      <h4>Checks & practice</h4>${evidenceHTML(checks)}<h4>Tutor noticed</h4><p class="lp-muted">Impressions from recorded conversations. Asking for help does not mean you cannot do it, and tutor impressions do not earn a checked tick.</p>${evidenceHTML(observations,true)}`;
  }
  hierarchyHTML() {
    const n=supportOverview(this.map?.chapters);
    return `<div class="lp-support"><div><strong>${n.checked} / ${n.total}</strong><span>mapped skills with recorded checks</span></div><div><strong>${n.supported}</strong><span>supported by repeated checks</span></div><div><strong>${n.recheck}</strong><span>need a fresh check</span></div><div><strong>${n.observed}</strong><span>have tutor observations</span></div></div><p class="lp-muted">This is evidence coverage, not a percentage of the course you know. Unmeasured areas stay unknown. Checked sections cover every mapped skill. Reading and prepared explanations do not mark a skill checked.</p>${this.finished ? `<p role="status">Check finished: ${esc(this.finished)}. The evidence below shows what changed.</p>` : ''}
      ${(this.map?.chapters || []).map(ch => `<details class="lp-chapter" data-lp-chapter="${esc(ch.n)}" ${this.openCh.has(String(ch.n)) ? 'open' : ''}><summary><span>${esc(ch.n)} · ${esc(ch.title)}</span><span class="lp-badges">${progressBadge(ch, true)}<small>${ch.progress?.confirmed_sections || 0} / ${ch.progress?.total_sections ?? conceptSections(ch).length} sections checked</small></span></summary>
      ${conceptSections(ch).map(s => `<details class="lp-section" data-lp-section="${esc(s.id)}" ${this.openSec.has(s.id) ? 'open' : ''}><summary><span>${esc(s.id)} · ${esc(s.title)}</span><span class="lp-badges">${progressBadge(s)}<small>${s.progress?.confident_skills || 0} / ${s.skills?.length || 0} skills confirmed</small></span></summary>
        <p class="lp-coverage">${esc(s.progress?.coverage_label || 'Coverage has not been reviewed yet.')}</p>${s.progress?.question_count > 0 ? `<button data-lp="section-check" data-id="${esc(s.id)}">Check section</button>` : '<p class="lp-muted">No authored checks for this section yet.</p>'}
        <ul class="lp-skills">${(s.skills || []).map(k => `<li><button data-lp="skill" data-id="${esc(k.id)}"><span>${esc(k.title)}<small>${esc(k.reason || 'No independent check recorded.')}<br>${esc(k.evidence_strength||'Not yet measured')} · ${k.support?.last_check?'last check '+esc(date(k.support.last_check)):'no independent check'}</small></span><span class="lp-state">${esc(states[k.state] || 'Not checked')}${k.due ? '<small class="lp-due">Review due</small>' : ''}</span></button></li>`).join('') || '<li class="lp-muted">Skill mapping is not available yet.</li>'}</ul></details>`).join('')}</details>`).join('')}`;
  }
  questionHTML() {
    const q = this.q, a = this.answer;
    return `<h3>${esc(this.check.label)}</h3><p class="lp-muted">Check ${this.check.index + 1} of ${this.check.ids.length}</p><div class="mdb lp-stem">${mdlite(q.stem)}</div>
      <div class="lp-options">${[...q.choices, "I don't know yet"].map((text, i) => `<button data-lp="pick" data-pick="${i === q.choices.length ? -1 : i}" ${a || this.busy || this.submission ? 'disabled' : ''}>${mdlite(text)}</button>`).join('')}</div>
      ${a ? `<div class="lp-result" role="status"><b>${a.correct ? 'Correct.' : this.submission.dont_know ? 'Recorded: not known yet.' : 'Not quite.'}</b><div class="mdb">${mdlite(a.why || '')}</div><p>Skill: ${esc(states[a.state?.state] || 'Not checked')}</p></div><button data-lp="next">${this.check.index + 1 < this.check.ids.length ? 'Next check' : 'Finish check'}</button>` : this.busy ? '<p role="status">Saving answer…</p>' : ''}`;
  }
  paint({ reveal = false } = {}) {
    if (!this.host?.isConnected) return;
    const inDetail = this.check || this.skillId;
    this.host.innerHTML = `<div class="lp-view">${inDetail ? `<button class="lp-back" data-lp="back">${controlIcon('left')} Back to progress</button>` : '<button class="lp-refresh" data-lp="refresh">Refresh</button>'}
      ${this.error ? `<div role="alert" class="lp-error"><p>${esc(this.error)}</p><button data-lp="${this.submission ? 'retry-answer' : 'retry'}">Try again</button></div>` : ''}
      ${this.refreshError ? '<p role="alert">Answer saved. Progress could not refresh. <button data-lp="refresh">Refresh progress</button></p>' : ''}
      ${this.loading ? '<p role="status">Loading…</p><button data-lp="cancel">Cancel</button>' : this.cancelled ? '<p>Progress closed.</p><button data-lp="refresh">Open progress</button>' : this.skill ? this.skillHTML() : this.check && this.q ? this.questionHTML() : this.check || this.skillId ? '' : this.hierarchyHTML()}
      </div>`;
    math(this.host);
    // Re-enter the relevant pane on a user transition, never on a resize/remount.
    if (reveal && typeof requestAnimationFrame === 'function') {
      const host = this.host, seq = this.seq;
      requestAnimationFrame(() => { if (host === this.host && host.isConnected && seq === this.seq) (host.closest('.st-sec') || host).scrollIntoView({ block: 'start' }); });
    }
  }
}
