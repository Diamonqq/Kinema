import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=name=>fs.readFileSync(new URL('../../static/'+name,import.meta.url),'utf8');
const specificity=selector=>(selector.match(/\.[\w-]+/g)||[]).length;

test('the lab host scrolls even though the artifact panel hides overflow',()=>{
  const panel=css('teacher.css').match(/([^{}]*\.artifact-scene)\{[^}]*overflow:hidden/);
  assert.ok(panel,'teacher.css still clips .artifact-scene');
  const host=css('experiments.css').match(/([^{}]*\.artifact-scene\.exp-shell)\{[^}]*overflow:auto/);
  assert.ok(host,'experiments.css re-enables scrolling on the lab host');
  assert.ok(specificity(host[1])>specificity(panel[1].trim().split(',').pop()));
});
