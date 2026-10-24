import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document ??= { createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, append() {}, addEventListener() {} }) };
const { Experiments } = await import('../../static/js/experiments/experiments.js');

function section(thread, api) {
  return { t: { thread, d: { url: p => p, api } }, saveTimers: new Map(), save: Experiments.prototype.save };
}

test('a saved experiment state uses the newest revision of the thread, not the one captured when the timer was set', async () => {
  const calls = [];
  const s = section({ id: 'a', revision: 7, pending: null }, async (url, opts) => { calls.push(JSON.parse(opts.body).revision); return { ok: true }; });
  await s.save({ id: 'a', revision: 3, pending: null }, { params: {} });
  assert.deepEqual(calls, [7]);
});

test('no save while a reply is pending', async () => {
  const calls = [];
  const s = section({ id: 'a', revision: 7, pending: 'job' }, async () => { calls.push(1); });
  await s.save({ id: 'a', revision: 3 }, {});
  assert.equal(calls.length, 0);
});

test('a revision conflict retries once with the server revision, silently', async () => {
  const calls = [];
  const s = section({ id: 'a', revision: 7, pending: null }, async (url, opts) => {
    const revision = JSON.parse(opts.body).revision; calls.push(revision);
    if (revision === 7) throw Object.assign(new Error('conflict'), { status: 409, body: { thread: { id: 'a', mode: 'experiment', revision: 9, pending: null } } });
    return { ok: true };
  });
  await s.save({ id: 'a', revision: 7 }, {});
  assert.deepEqual(calls, [7, 9]);
});

test('a conflict that is still pending or repeats is dropped without another request', async () => {
  let n = 0;
  const conflict = pending => Object.assign(new Error('conflict'), { status: 409, body: { thread: { id: 'a', mode: 'experiment', revision: 9, pending } } });
  await section({ id: 'a', revision: 7 }, async () => { n++; throw conflict('job'); }).save({ id: 'a' }, {});
  assert.equal(n, 1);
  n = 0;
  await section({ id: 'a', revision: 7 }, async () => { n++; throw conflict(null); }).save({ id: 'a' }, {});
  assert.equal(n, 2);
});

test('a save for a thread that is no longer open uses the revision it has', async () => {
  const calls = [];
  const s = section({ id: 'b', revision: 1 }, async (url, opts) => { calls.push([url, JSON.parse(opts.body).revision]); });
  await s.save({ id: 'a', revision: 4 }, {});
  assert.deepEqual(calls, [['/api/teacher/threads/a/experiment', 4]]);
});
