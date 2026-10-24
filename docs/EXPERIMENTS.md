# Kinema Experiments (CUPS rebuilt) — wave 1 plan

Owner request (2026-10-23): recreate the CUPS (Consortium for Upper-Level Physics
Software, 1990s DOS) simulations "but way better" and add them to Kinema cleanly.
Original source/help: https://github.com/palazzol/cups (DOS/CUPS/<PACKAGE>/<PROGRAM>).
Read the original .HLP and physics .PAS for capabilities; never copy its code or text.

Wave 1 covers what Kinema's mechanics books use (Morin ch. 1-14):

| id | CUPS original | Source dir | Morin |
|---|---|---|---|
| coupled-oscillators | Coupled Oscillators | CUPSCM/COUPOSC | 4 |
| motion-generator | The Motion Generator (general force) | CUPSCM/GENMOT (GMGENER, GM1DGRAV) | 1-5 |
| projectile-air | Projectile Motion in Air | CUPSCM/GENMOT | 2-3 |
| pendulum | Pendulum (large-angle, damped, driven, chaos) | CUPSCM/GENMOT (GMPEND) | 4 |
| race-track | Race Track | CUPSCM/GENMOT (GMRACE) | 3, 9 |
| orbits | Gravitational Orbits | CUPSCM/ORBITER | 6-7 |
| anharmonic | Anharmonic Oscillators | CUPSCM/ANHARM | 4-5 |
| collisions | Two Body Collisions | CUPSCM/COLISION | 5 |
| rigid-rotation | Rigid Body Rotational Dynamics | CUPSCM/ROTATE | 8-9 |
| minkowski | Special Relativity (Minkowski diagrams) | CUPSMP/SPECREL | 11 |
| rel-kinematics | Relativistic Kinematics | CUPSNP/RELKIN | 12-13 |

Later waves (owner asked for "all"): E&M, waves/optics, thermal/statistical,
quantum, modern, nuclear/particle, solid state, astrophysics. They reuse this kit.

## Product shape

- Sidebar entry **Experiments** opens a gallery grouped by subject (Mechanics,
  Relativity) with live, honest thumbnails. No streaks, points or suggested-next cards.
- Opening one starts or resumes an experiment conversation: the normal Kinema chat,
  history and composer on the left, the experiment artifact already open on the right
  with the existing resizable divider and expand; narrow windows use the sheet.
  Experiment chats appear in normal chat history; they write no learner evidence.
- The greeting is local text (no provider call): the experiment name and one line.
- The tutor sees the experiment's current parameters, time and key observables.
  A reply may carry a bounded experiment action validated against that experiment's
  schema: set parameters, choose a preset, play/pause/reset, open a close-up,
  toggle Breakdown or a graph. Applied actions show one small quiet chip in the reply
  ("k₂ → 40 N/m"). Invalid actions are dropped, never guessed. This is the
  "what AI can do now" showcase: describe a change in words, the experiment follows.

## Artifact design rules (from the owner's feedback; all are requirements)

- Dark, clean, minimal; small blue-on-black accents; light Panel-style bubbles and
  menus. No decorative separator lines, no "Details" bloat, no duplicate toolbars.
- Real physics in proportion. The main view frames the whole actual motion, starts
  centered, stays centered while running and Reset re-centers. No "Fit" button.
- Icon transport: Play/Pause toggle, Reset, time scrubber, speed. Never "Resume".
- First view is quiet: the apparatus, motion and one compact key. Extras sit behind
  buttons: **Setup** (parameters + presets), **Graphs**, **Breakdown**.
- Close-ups are obvious click-me targets on the scene (e.g. a small "Zoom" chip by a
  spring) that animate to a magnified view showing the governing term, e.g.
  F = −k(x₂ − x₁) with live signed values. Back returns to the full view.
- Breakdown shows the force/trig/geometry decomposition with correctly placed
  angles and the resulting equation, written cleanly, updating live.
- Labels never jitter or chase: anchor to bodies with smoothing and collision
  avoidance, or keep them in fixed caption bands. Never more labels than needed.
- Linked graphs share one time cursor with the scene (x(t), phase space, energy,
  spectra as relevant). Phase-space and Poincaré views where CUPS had them.
- Presets are chips that teach something specific ("Mode 1", "Beats", "Chaos").
- Desktop and 320 px widths both usable; controls reachable above the composer.

## Shared polish conventions (lead review + independent judge, wave 1)

- Zoom chips sit beside a FIXED point of their target, such as a pivot, rest
  position, launch point, apex, spring midpoint, periapsis or barycentre. They
  never cover the apparatus, readouts or captions. Close-ups with no physical
  target (potential, Poincaré) share one wrapping row. All chips use the kit chip
  style with no custom sizes. View toggles that are not zooms go in Setup, not in
  chip rows.
- Every label stays inside the stage at 1280 and 320. Components that coincide with
  their full vector (zero bank, zero angle) are hidden rather than drawn on top of
  it. At 320, drop secondary labels before anything overlaps, and give stacked
  frames a readable minimum height (about 150 px).
- One title per graph. A custom graph's shell header is its title, so draw no
  in-canvas title. Graph chips show names only; units go in the panel title.
  Legends use symbols (θ, ω), never spelled-out words.
- Time-series graphs show a readable window: about 5 periods or one beat, set with
  descriptor `window` (seconds). The y range stays fixed over the whole forecast.
  Motion that ends (a landing) ends the timeline with `sample.ended`.
- Captions are built from what is actually drawn, so their colours and names match
  the picture. No preset names floating as captions.
- Text: US spelling (center, tire), typeset minus "−" in canvas text, accented
  Poincaré. Use the same symbol for the same quantity across experiments. Numbers
  get 2–4 significant figures and a unit (9.81 kN, not 9810.00). Equations end in a
  number with its unit.
- Defaults read as real, recognisable physics with readable magnitudes, and
  degenerate defaults (a flat bank in a bank Breakdown) are avoided.
- Breakdown and Graphs keep the transport pinned to the pane bottom, with no empty
  band beneath it. Debug or diagnostic graphs are not shown to learners.

## Physics core contract (headless, Node-testable, no DOM)

`static/js/experiments/<id>/model.js` exports `model`:

```js
export const model = {
  id: 'coupled-oscillators', title: 'Coupled oscillators',
  params:  [{ key:'m1', label:'Mass 1', symbol:'m_1', unit:'kg', min:.1, max:10, step:.1, value:1, group:'Masses' }],
  presets: [{ id:'mode1', label:'Mode 1', values:{...}, note:'Both masses move together at ω₁' }],
  observables: [{ key:'x1', label:'Displacement 1', symbol:'x_1', unit:'m' }],
  create(values) { /* returns an instance */ },
};
// instance: { t, step(dt) /* advances exactly dt; sub-steps internally */,
//             reset(), sample() /* {t, ...observables} */,
//             invariants() /* {energy, momentum, angularMomentum, ...} as applicable */,
//             geometry() /* positions/orientations a renderer needs, SI units */ }
```

A param may carry `appliesWhen: { otherKey: [allowed values...] }` when it only does something under
some other setting, e.g. `{ key:'parentMass', ..., appliesWhen:{ reaction:['decay'] } }`. Every key
must hold one of its listed values (AND across keys, OR within a list); `otherKey` is another param of
the same manifest (an unknown key, itself, or an empty list hides the card). A param whose rule is unmet
by the current values is *inert*. The tutor context (`app/experiments.py` `compact`) marks it
`inert:true` and tells the tutor never to suggest or change it on its own; a `set_params` that touches an
inert param is dropped unless the same action also sets the controlling param, so "custom decay with
M = 500 MeV" works. The UI is free to dim or hide inert controls. The tutor receives a compact manifest
(param limits and options, preset id/label/note plus `sets`, close-up and graph id/label, observables). A preset's `sets`
lists only the params it changes from the defaults, by symbol or label. Every observable needs a `label`: replies name readouts by
label and never quote an internal key. Each recorded assistant turn that applied an action carries `applied` in the conversation
(preset label, or the chip text), and the tutor is told that `current_state` is authoritative, so it does not "correct" earlier
numbers that an applied action has since changed. Action chips show a param's symbol (plain text) or else its label, never its key.

Choose integrators per physics (symplectic for conservative, RK4/adaptive RK45 for
damped/driven, quaternions for rotation). Tests in `tests/experiments/<id>.test.mjs`
run with `node --test` and compare against analytic results (normal-mode
frequencies, small-angle and exact pendulum periods, Kepler period/elements, vacuum
projectile range, elastic-collision momentum/energy, torque-free precession rate,
interval invariance, threshold energies) plus conservation tolerances.

## Ownership

- Kit author: shell, gallery, chat/teacher integration, experiment action contract,
  shared stage/graphs/controls/close-ups/breakdown, `static/js/experiments/kit/`,
  and the complete coupled-oscillators reference experiment.
- Physics lanes: only `static/js/experiments/<id>/` and `tests/experiments/<id>*`.
  They wire views onto the kit after it lands, in the same author's follow-up.
- Stage: chat scratch `kinema-active/round-156/stage` (branch cups-experiments,
  based on public v1.49.0). Keep hooks into existing files small and listed, so the
  same experiments can be ported to the private 1.48 installation.
