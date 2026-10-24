import test from 'node:test';
import assert from 'node:assert/strict';
import {easeCamera,VectorStage} from '../../static/js/experiments/kit/stage.js';
import {mapPanel} from '../../static/js/experiments/minkowski/drawing.js';

test('camera ease lands exactly on its target and then reports no motion', () => {
  const camera={cx:0,cy:0,scale:40},target={cx:3.2,cy:-1.5,scale:220};let steps=0;
  while(easeCamera(camera,target)){steps++;assert.ok(steps<200,'ease never settled');}
  assert.deepEqual(camera,target);assert.ok(steps>5,'ease should animate, not jump');
  assert.equal(easeCamera(camera,target),false);assert.deepEqual(camera,target);
});

test('panel zoom keeps the stage animating until it reaches the target bounds', () => {
  const s={},p={left:0,top:0,width:400,height:300},wide=[-10,10,-8,8],close=[-1,1,-.8,.8];
  mapPanel(s,p,wide);let frames=0,m;
  do{s.animating=false;m=mapPanel(s,p,close);frames++;assert.ok(frames<200,'panel zoom never settled');}while(s.animating);
  assert.deepEqual(m.bounds,close);assert.ok(frames>5);
  s.animating=false;assert.deepEqual(mapPanel(s,p,close).bounds,close);assert.equal(s.animating,false);
});

test('each drawn frame starts with no pending animation', () => {
  const ctx={setTransform(){},clearRect(){}},s=Object.assign(Object.create(VectorStage.prototype),{ctx,dpr:1,w:10,h:10,animating:true});
  s.begin();assert.equal(s.animating,false);
});
