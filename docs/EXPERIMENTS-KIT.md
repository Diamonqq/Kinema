# Experiments kit

## Add an experiment (stable wave-one API)

Own only `static/js/experiments/<id>/` and your tests. The gallery discovers a
`manifest.json` only when both `model.js` and `view.js` exist. No shared registry
edit is needed. Use this manifest (all parameter limits are enforced by Python):

```json
{"id":"example","title":"Example","group":"Mechanics",
 "description":"One sentence about the experiment.",
 "params":[{"key":"mass","label":"Mass","unit":"kg","min":0.1,"max":10,"step":0.1,"value":1}],
 "presets":[{"id":"gentle","label":"Gentle","values":{"mass":1}}],
 "closeups":[{"id":"force","label":"Zoom · force"}],
 "graphs":[{"id":"motion","label":"Motion"}]}
```

Enums use `options:[{value:"rk4",label:"Numerical"},...]` instead of numeric
bounds. Numeric option values retain their numeric type in selects. Numeric steps
are relative to `min`. Include every editable parameter,
preset, close-up and graph in this manifest; use the same descriptors on `model`.

`model.js` has no DOM dependency. Export `model` following EXPERIMENTS.md:
`{id,title,params,presets,observables,create(values)}`. An instance exposes
`t`, `step(dt)`, `reset()`, `sample()`, `invariants()`, `geometry()`.
`step(dt)` advances exactly dt with its own bounded substeps. Return finite values.

`view.js` exports `view`:

```js
export const view = {
  draw(stage, frame) {
    const {ctx,w,h} = stage; // CSS pixels; HiDPI transform already applied
    const {geometry,sample,params,instance,t,breakdown,closeup} = frame;
    // stage helpers: line(x1,y1,x2,y2,color,width), text(text,x,y,color,size,align),
    // circle(x,y,r,color), spring(x1,y1,x2,y2,color,amplitude), arrow(...).
    // stage.world([xmin,xmax,ymin,ymax], padding=36) returns {x,y,scale}.
    // Choose a FIXED bound over the actual motion, never recenter each frame.
  },
  graphs: [{id:'motion',label:'Displacement',unit:'m',series:[
    {key:'x',label:'x',color:'#82b5ff'}]}],
  closeups: [{id:'force',label:'Zoom · force'}],
  closeupAnchors(stage,frame) { return {force:{x:stage.w/2,y:stage.h/2+90}}; },
  equations(frame) { return ['F=-kx']; }, // KaTeX, when Breakdown is open
  closeupEquation(frame) { return ['F=-kx','=-20(0.1)=-2\\,\\mathrm{N}']; },
  // Optional pointer drag on stage. Return true to capture the pointer.
  pointer(stage, frame, {type,x,y}) { return false; },
};
```

Mount with `import {ExperimentShell} from '../kit/shell.js'` then
`new ExperimentShell(host,{model,view,manifest,values,onChange})`. The normal
integration does this automatically. `onChange(snapshot)` supplies bounded
`{params,t,observables,playing,closeup,breakdown,graphs}`. The shell owns one
animation loop, setup/presets, time replay, shared graph cursor, KaTeX cards and
cleanup. Call `destroy()` on unmount, `resize()` on artifact layout changes,
`snapshot()` before tutor send, `apply(action)` for server-validated actions.
Optional 3D views can import `/vendor/three/build/three.module.js` and provide
`view.mount(shell)` returning `{draw(frame),resize(),destroy()}`; the canvas
stage stays the default and is hidden when a custom renderer is mounted.

For changes during drag call `frame.setParams(patch)`; this pauses, resets and
updates the existing model without rebuilding controls. It returns false on
schema or model rejection, preserving params, instance, time, graphs, forecast,
controls and saved values. Creation happens before commit. Invalid restored
setups recover to defaults with a quiet explanation. A rejected tutor action has
no applied chip; the retained snapshot is saved back.

`frame.setCloseup(id)`
selects an authored close-up. Transport uses icon play/pause and reset, a scrubber
and speed. No provider runs on entry. No learner evidence is written.

The gallery card calls `view.draw` once at t=0 on a small canvas with
`frame.thumbnail===true`; draw only the apparatus there (no readouts, captions or
chips). Ordinary time-series axes always include zero and pad only on the side that
has data, so nonnegative quantities never show a negative lower tick.

Optional `view.graphDescriptors(params)` replaces the static graph descriptors
when the series count depends on setup. `view.closeupAnchors(stage,frame)` returns
stable CSS-pixel anchors by close-up ID; reserve separate rows for captions,
readouts and the chip. Without it, chips sit in a wrapping top row. The shell
clamps anchored chips inside the scene. `stage.labels` contains the actual canvas
text bounds from the last paint for collision checks. The reference experiment
uses fixed equilibrium columns, removes secondary readouts at small spacing and
keeps camera bounds fixed for the entire motion.

Graph preparation starts after the first paint, in cancellable batches of eight
samples with an event-loop turn between batches. At most 3,601 samples are held
for the 60-second playback. `shell.forecastComplete`, `forecastGeneration` and
`samples` report actual coverage; incomplete graphs explicitly show their computed
duration and stop their axis there. Param changes/destroy cancel old batches.
The adapter also accepts optional named module exports
`prepareUpdate(currentValues,patch)` returning `{ok,values,instance}` or
`{ok:false,error:{message}}`, and `sampleBatches(values,{duration,interval,batchSize})`
returning a lazy iterator of sample arrays. These may instead be properties of
`model`. Every model works through the generic path without these helpers.

## Custom graph panels (optional)

Declare `kind:'custom'` on the graph descriptor in **both** `view.graphs` (or its
dynamic descriptors) and the matching manifest `graphs` entry:

```js
graphs: [{id:'potential',label:'Potential well',kind:'custom'}],
drawGraph(stage, descriptor, frame) {
  const map=stage.world([-2,2,-1,3],16);
  stage.line(map.x(-2),map.y(0),map.x(2),map.y(0));
  stage.circle(map.x(frame.sample.x),map.y(1),4);
  stage.text('position',stage.w-36,stage.h-9);
}
```

The shell gives each custom panel its own canvas, ordinary graph chip, panel
chrome and title. Every visible frame calls `view.drawGraph(stage,descriptor,frame)`
with the **same frame object** used by the scene. `stage` is a normal VectorStage:
`ctx,w,h`, HiDPI backing pixels, all helpers, `world()` and measured `labels`.
The shell resizes and clears the custom canvas first. It draws **no time axis or
cursor**; the view owns axes, labels, live markers and caching any precomputation.
Toggling a custom graph off stops its draw callback. Existing time-series,
phase-space and spectrum descriptors keep their ordinary linked rendering.

## Scenario Setup fields (optional)

```js
paramVisible(spec, values) {
  return spec.key!=='driveAmplitude'||values.scenario==='driven';
}
```

The shell evaluates this boolean hook when Setup renders and after each accepted
parameter change. False hides that field; a group with no visible fields is also
hidden. Values are retained and become visible again when the scenario permits.
Presets and validated tutor actions can still update hidden fields. This hook
changes presentation only: manifest bounds, steps, options and server validation
are unchanged. Without it, Setup preserves its current behavior.

## Numerical seeking and narrow graphs

### Time windows and terminal events

Ordinary time-series descriptors may add `window: 8` (seconds). When the computed
forecast exceeds that length, the x range is
`[clamp(t - window/2, 0, end - window), start + window]`. The cursor, endpoint labels
and `plot.timeAt(canvasX)` all use that range. The y range always uses **all**
forecast samples, never only the visible slice, so moving the cursor cannot rescale
it. During background forecasting that range may grow as new samples arrive; once
the forecast completes it stays fixed. Omit `window` for the entire timeline.
Phase, spectrum and custom graphs ignore this option. Choose about five periods
or one beat period in `view.graphDescriptors(values)`.

A model may return `sample().ended === true` at its terminal event, with `t` at
the event itself (e.g. interpolate a landing). Its `step` must stop at that event
and report the same terminal sample on later calls. The kit stops either generic
or optimized `sampleBatches` at the first such sample. Graphs end there; the known
duration, range input and seeks clamp there, and playback pauses once. Reset and
Play at the end restart the model at zero while keeping the known end. Parameter
changes start a new forecast with the default 60 s ceiling until its event is
known. Numerical seeks also stop if they discover an event before the requested
time. Models without `ended` retain the 60 s timeline. A time-zero end is valid.

`shell.seek(seconds)` returns a Promise. Numerical replay uses a private candidate
and yields with MessageChannel tasks after about 14 ms of work. Forecast tasks use
about 8 ms while playing or 14 ms paused. The original 1/60 step boundaries are
unchanged; batching never changes a trajectory. The current scene stays intact
until the newest seek finishes, then commits
the candidate and saves its exact time. A newer seek, accepted parameter change,
Reset, Play or destroy cancels stale replay through a generation ID. Failed replay
keeps the existing scene and reports a quiet error. The analytic coupled-oscillator
mode path remains immediate; its physics and scrubber behavior are unchanged.

## View work and cleanup

The shell renders dirty frames and active playback. It sleeps while paused and
clean, and suspends rendering and forecast work when its pane or document is
hidden. Pointer interaction, camera settling, resize, parameter changes and
explicit controls still redraw. An asynchronous view must call
`frame.invalidate()` (or `shell.invalidate()`) after publishing new results;
it must not rely on an idle animation loop to poll its private state.

`shell.signal` and `frame.signal` are an AbortSignal for the current setup.
Accepted parameter changes, any forecast restart, and destroy abort that signal.
The next forecast gets a new signal. Invalid parameter candidates leave the
current signal and view intact. Capture the signal for each computation, check it
before each chunk and before publishing results. A signal never grants permission
to mutate a destroyed view. `shell.onCleanup(callback)` is a convenience for
registering once-only cleanup on that same signal; it returns an unregister
function. Register again when starting work for a new setup.

```js
const signal = frame.signal; // capture this computation's lifetime
let timer;
const cancel = () => clearTimeout(timer);
signal.addEventListener('abort', cancel, {once:true});
function batch() {
  if (signal.aborted) return;
  const done = computeOneBoundedBatch();
  frame.invalidate();
  if (!done) timer = setTimeout(batch, 0);
  else signal.removeEventListener('abort', cancel);
}
batch();
```

Ordinary linked graphs cache their static paths, axes and registered labels;
time-series windows use binary sample bounds and preserve pixel-column extrema.
The cursor remains live. Custom graph callbacks keep their existing contract.
Live equation blocks update at most about four times per second while playing,
with changed blocks spread over frames and unchanged blocks retained. Pausing,
seeking and parameter changes update the exact current equations immediately.

At narrow widths, opening Graphs gives the scene its 280 px readable minimum and
scrolls only the experiment shell enough to reveal the first enabled graph canvas
above the transport. It does not scroll the surrounding chat. The same behavior
applies to ordinary and custom graph panels.

## Tutor action envelope

Reply JSON is `{reply:"Short explanation",action:null}` or one action:
`{type:"set_params",values:{k2:40}}`, `{type:"preset",id:"beats"}`,
`{type:"play"}`, `{type:"pause"}`, `{type:"reset"}`,
`{type:"closeup",id:"spring"}` (empty id returns to scene),
`{type:"breakdown",enabled:true}`, `{type:"graph",id:"motion",enabled:true}`.
Unknown keys, wrong types, off-step/out-of-range values, extra fields, unknown
presets/targets and nonfinite numbers drop the WHOLE action. Explanation survives.
The server receives params/time/observables when sending; model outputs are
reported observations, never trusted instructions. One action gives one quiet chip.

## Existing-file hooks for the private 1.48 port

- `app/teacher.py`: thread mode, public state, local create/resume, reply dispatch,
  snapshot acceptance, learner-evidence exclusion. Adds GET `/api/experiments`
  and revision-checked PUT `/api/teacher/threads/{tid}/experiment`; uses existing
  jobs, selected account/model, cancel tokens, attachments and normal history.
- `static/js/teacher.js`: sidebar/gallery entry, experiment adapter, send snapshot,
  reply action chip, artifact lifecycle and splitter participation; excludes
  experiments from automatic study-refresher consideration after a reply.
- `static/js/chat_study_pane.js`: excludes experiment threads from ordinary notes.
- `static/app.html`: experiments stylesheet.
- `app/main.py`: version bump only. Registry routes attach to Teacher's router.
- `static/js/app.js`: exempts experiment threads from native-stage keyboard
  shortcuts, alongside Simulation lab. No new composer or provider path.

All remaining source is new under `app/experiments.py`, `static/experiments.css`
and `static/js/experiments/`. No existing splitter, artifact or provider modules
were changed. The adapter creates a LessonSplitter instance using
`--exp-width` and `kinema.experimentPaneRatio.v1`, default 54%; thread snapshots
use the existing database state, with revision-matched browser recovery.

## Reference experiment and verification

Coupled oscillators implements a linear one-dimensional chain of 2–10 independently
editable masses and 3–11 springs, two walls/one wall/free ends, initial drag and
velocities, two-mode superposition, analytic mass-weighted normal modes and
independent Verlet/RK4 numerical motion, mass-proportional damping and first-mass
sinusoidal driving. Displacements and mass-weighted mode coordinates (?kg ? m) cover every active mass;
energy and phase space are optional graphs. Their time window is one beat period
from the two strongest active normal modes, or five periods of the lowest
nonzero mode if only one is excited. Spring labels carry N/m, and Breakdown
equations end with the live net force in N. The analytic bound frames the entire
60-second motion without waiting for forecast samples. General 2D spring-network
editing and arbitrary driven masses from original CUPS remain outside this chain
reference implementation.

Tests: `tests/test_experiments.py` mocks providers for lifecycle, snapshots,
numeric/enum schema validation and accepted/dropped actions;
`tests/experiments/coupled-oscillators.test.mjs` checks frequencies, eigenvectors,
beats, conservation, damping and driven response;
`tests/experiments/kit.test.mjs` checks transactional candidates, lazy bounded
batches and fixed motion envelopes. Browser fixtures/captures/receipts are kept
outside source in `round-156/kit/`, never shipped or connected to live accounts.

Physics is independently implemented from standard mechanics. CUPS help/source is
capability research only; its code and prose are not copied.
