import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const dir=new URL('../../static/js/experiments/rigid-rotation/',import.meta.url);
const threeURL=new URL('../../static/vendor/three/build/three.module.js',import.meta.url).href;
const formatURL=new URL('../../static/js/experiments/kit/format.js',import.meta.url).href;
const modelURL='data:text/javascript;base64,'+Buffer.from(await readFile(new URL('model.js',dir),'utf8')).toString('base64');
const text=await readFile(new URL('view.js',dir),'utf8');
const source=text.replace("'/vendor/three/build/three.module.js'",JSON.stringify(threeURL)).replace("'./model.js'",JSON.stringify(modelURL)).replace("'../kit/format.js'",JSON.stringify(formatURL));
const {convexHull,rectHitsConvex,pointDepth}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const square=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];

test('convexHull keeps the outline of scattered points',()=>{
 const hull=convexHull([...square,{x:5,y:5},{x:2,y:3},{x:10,y:5}]);
 assert.equal(hull.length,4);
 for(const p of square)assert.ok(hull.some(h=>h.x===p.x&&h.y===p.y));
});

test('rectHitsConvex treats a rectangle on the silhouette as a hit and one beyond it as clear',()=>{
 const hull=convexHull(square);
 assert.equal(rectHitsConvex({x:8,y:8,width:6,height:6},hull,0),true,'overlaps the corner');
 assert.equal(rectHitsConvex({x:12,y:2,width:6,height:6},hull,0),false,'beside the edge');
 assert.equal(rectHitsConvex({x:10.5,y:2,width:6,height:6},hull,1),true,'padding closes a small gap');
 const diamond=convexHull([{x:5,y:0},{x:10,y:5},{x:5,y:10},{x:0,y:5}]);
 assert.equal(rectHitsConvex({x:8,y:0,width:4,height:3},diamond,0),false,'the bounding box corner of a diamond is empty');
 assert.equal(rectHitsConvex({x:4,y:4,width:2,height:2},diamond,0),true,'inside');
});

test('pointDepth is the distance a point lies inside the outline',()=>{
 const hull=convexHull(square);
 assert.equal(pointDepth(hull,5,5),5);
 assert.equal(pointDepth(hull,2,5),2);
 assert.equal(pointDepth(hull,11,5),0);
});

test('Round 3 sources: silhouette labels, near-target chips, padded thumbnail and complete readout',()=>{
 assert.match(text,/hitsBody=\(a,pad\)=>currentShapes\.some\(poly=>rectHitsConvex\(/);
 assert.match(text,/shell\.rotationBodyHulls=hullBoxes/);
 assert.match(text,/function placeNear\(f,ids,width,ppu,ref\)/);
 assert.match(text,/function sceneScale\(f,width,height\)/);
 assert.match(text,/shell\.rotationChipTargets=chips\.targets/);
 assert.match(text,/scale=\.7\*Math\.min/,'thumbnail keeps about 10% around the body');
 assert.match(text,/`\u03b8 = \$\{num\(f\.sample\.theta\)\} rad \u00b7 T = \$\{num\(f\.sample\.kinetic\)\} J`|`θ = \$\{num\(f\.sample\.theta\)\} rad · T = \$\{num\(f\.sample\.kinetic\)\} J`/);
 assert.match(text,/' · τ = 0 N m'|' · τ = 0 N m'/);
});
