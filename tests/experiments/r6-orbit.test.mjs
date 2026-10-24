import test from 'node:test';
import assert from 'node:assert/strict';
import {graphHeight} from '../../static/js/experiments/collisions/view.js';
test('collision graph zooms lift the plot, and so its x title, clear of the caption: more on a narrow stage that wraps it',()=>{
 assert.equal(graphHeight({w:569,h:460}),452);
 assert.equal(graphHeight({w:306,h:460}),436);
 assert.ok(graphHeight({w:306,h:460})<graphHeight({w:569,h:460}));
});
