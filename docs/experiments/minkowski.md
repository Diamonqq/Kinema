# Minkowski diagrams — physics and renderer brief

## CUPS capability research

Read the original
[SPECREL](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SPECREL.PAS),
[SRMINKX](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SRMINKX.PAS),
[SROBJ1](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SROBJ1.PAS),
[SROBJ2](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SROBJ2.PAS),
[OBJECTS](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/OBJECTS.PAS),
and [SRLIST](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SRLIST.PAS).
The coverage pass read **all** of the local SPECREL.PAS, SRMINKX.PAS, SROBJ1.PAS
and SROBJ2.PAS copies in `round-156/cups-src`, including embedded help and actual
dispatch/transform implementations. The earlier web reads of OBJECTS/SRLIST were
partial; no claim relies on unseen branches of those files. The DOS executable
was not run. No original source code, assets or prose are incorporated here.

This core adds exact, named teaching scenarios, consistent linked simultaneity
slices, analytic light interception/reflection, proper-time ticks, invariant
calibration curves and tests. Coverage below means **headless physics/data**, not
finished controls or rendered views. The instance contract is unchanged.

## CUPS coverage

| Original physics, objects, examples or plots | Kinema | Evidence / boundary |
|---|---|---|
| Two independently selected inertial frames, arbitrary x/y/z relative velocity | Improved | `boost`, `lorentzMatrix`, advanced `beta/betaY/betaZ`; chosen coordinate-time playback, linked event identities. Ground is the reference frame, moving is arbitrary relative to it. |
| Forward and inverse event-coordinate transforms; positions/velocities specified in either frame | Yes | General 3D boost and inverse (negate all beta components); object coordinates/velocities are ground-frame params. A later editor can convert inverse inputs with these helpers; no duplicate unsynchronized state. |
| Constant-velocity trajectories and worldlines/worldtubes of body vertices | Improved | Analytic simultaneous vertex slices in both frames, worldline segments and proper-time ticks; contractions use the velocity direction. No force/collision dynamics implied. |
| Stick/rod, editable proper length | Improved | `objects` + `rod`; rest length L, contraction in each observing frame. |
| Rocket, proper length and shape | Yes | `rocket`, independently authored finite outline, arbitrary subluminal object velocity. |
| Barn, finite outline | Yes | `barn` plus pole/barn timing scenario; no rigid-body collision model. |
| Rectangle, proper length and width | Improved | `rectangle`, `widthRatio`; correct longitudinal contraction and unchanged transverse width for parallel motion. |
| Ball | Yes | `ball` is a **point tracer**, as its original one-vertex implementation was; no extended sphere is claimed. |
| Flash emitted at editable t,x,y,z, spherical spatial front, spacetime light cone | Improved | `flash` + `emissionTime/offsetX/Y/Z`, analytic light fronts and exact boosted emission in both frames; absent before emission. Three great circles expose xy/xz/yz sections. |
| Up to six arbitrary independently editable objects in one scene | Improved | `bodyCount` 1..6; each body has its own type, proper dimensions, 3D velocity, initial position and emission time. Analytic simultaneous slices replace copied object state. Extra rows belong behind Setup and appear only for active objects. |
| xt plots | Improved | x/ct event and worldline data, equal units, linked now line, calibration and proper-time ticks. |
| xy plots | Yes | All object/light vertices contain x/y/z; direct spatial projections are available. |
| xyt plots, optional worldtubes/light cones | Yes | Full spacetime vertex lines, emitted cone event plus spherical sections; renderer can connect corresponding finite-object vertices. No rasterized CUPS surfaces reused. |
| xyz plots | Yes | Full 3D event, outline and spherical-section data; renderer follow-up chooses perspective. |
| Editable four-vector calculator, same four plot projections | Improved | `vectorCt/X/Y/Z`, `transformFourVector`; ground/moving components and invariant norm. Units are dimensionless abstract components, explicitly separate from SI event coordinates. |
| General rank-two contravariant 4×4 tensor, symmetric/antisymmetric constraints, transforms on both indices | Improved | 16 component params, `transformTensor`, `symmetrizeTensor`, ΛTΛᵀ and invariant contraction. Constraint selection orthogonally projects supplied components; it does not silently take only the original upper triangle. |
| General/symmetric tensor plots of mapped 4-cube in xt/xy/xyt | Yes | `calculator.tensor.cubeGround/cubeMoving`: 16 mapped vertices; connect indices differing in one bit. Project components [ct,x,y,z] as requested. |
| General/symmetric tensor xyz plot | Improved | Original SROBJ2 xyz branch is empty; the same mapped vertices now permit this projection too. |
| Antisymmetric tensor pair of E/B-like three-vectors in xt/xy/xyt/xyz | Yes | `calculator.fieldAnalogy` in both frames: electric components T_i0, magnetic (T_32,T_13,T_21). Abstract components, not a claim of SI electromagnetic units. |
| Startup example: simultaneous spatially separated flashes viewed in a boosted frame, both graphs xyt | Improved | `Two light flashes` recreates the idea with SI length scale and explicit simultaneity offsets, rather than copying its coordinates. Beta is adjustable, including negative values. |
| Startup four-vector pointing spatially along x | Yes | Four-vector default [0,1,0,0]. |
| Startup antisymmetric tensor with two independent time-space components | Yes | All those components are selectable; our quieter default has just one independent component. |
| Saved physics configurations; first three external Saved.dat entries protected | Deliberately omitted | Full-valued reproducible preset snapshots replace DOS configuration compatibility. The six supplied sources do not contain external Saved.dat example names/content; those are not invented. Persistence UI belongs to the kit. |
| Blinker listed in object menu | Deliberately omitted | No implemented object class/AddObject dispatch exists in supplied source. Menu presence is not a physics capability. |
| Scalar transform declaration | Deliberately omitted | Original scalar Transform body is empty; scalar invariance is already implicit. No working scalar calculator is claimed. |

`SetPathFunctions` uses linear coordinates in time. The original has
**no implemented acceleration solver** in the supplied full sources. Our twin
turnaround is a new piecewise-inertial idealization, not an asserted copy of an
original accelerated-rocket mode. Rods, clocks, twins, lightning, velocity addition
and catch-up presets add explicit teaching goals beyond the original startup.

## Model and units

`model.js` exports the required `model` descriptors and instance API. Named utility
exports include `C`, `gamma`, `boost`, `interval`, `addVelocity`, `lorentzMatrix`,
`transformFourVector`, `transformTensor`, `symmetrizeTensor`, `lightWavefront`. Coordinates are metres
and seconds with exact SI c = 299792458 m/s; plot vertical **ct in metres** with
equal x/ct scale so light is at 45 degrees. Never label a time axis ct while
feeding it seconds. Boost is passive: x' = γ(x−vt), t' = γ(t−vx/c²), y'=y for an
x boost. Arbitrary directions use metric +--- and components [ct,x,y,z]. Combined
frame and object speed norms must each be below one, even if components separately
fall in their descriptor ranges. betaY/Z apply only to the four advanced scenarios.

`length` means the initial ground source–mirror gap for both longitudinal mirror
scenarios, transverse mirror separation for the transverse clock, ground strike
separation for lightning, proper rod length for the rod/barn, and c times the
ground outbound duration for twins. Show the contextual label in Setup.
For twins the turnaround is at t=L/c, x=βL, so β=0 remains a valid identical-clock
limit. `uBeta` applies only to rocket launch; `barnRatio` only to the barn.

`step(dt)` advances exactly dt seconds in `frame`, independent of frame rate.
No integrator is needed; evaluation is analytic and reset returns t to zero.
`geometry().ground` and `.moving` contain event records and piecewise worldlines
with proper-time ticks; each has its representation of the **same** current
simultaneity slice. `geometry().objects` intersects worldlines with the selected
frame's t=now slice, including transverse y for the clock. Flash paths end at
absorption; bodies are finite segments bounded by the authored scenario horizon.
Proper ticks mark elapsed age since each worldline's marked starting event; they
do not assert that spatially separated clocks are synchronized in every frame.
`duration` is the authored **ground** horizon; the renderer should use the largest
transformed endpoint time when scrubbing in the moving frame. Do not clamp `step`.
Snapshots do not expose mutable internal points.

Advanced geometry: `solids[0].ground/moving` are independently simultaneous
outline vertices at coordinate t in each frame, not the same spacetime events.
Rod is an open two-point segment, ball one point, other outlines closed polygons.
`ground/moving.wavefronts` likewise use each frame's t; top-level `wavefronts`
selects the playback frame. Do not equate the two spatial slices. For advanced
objects the authored worldline segment spans −12L/c to +12L/c; ticks count age
from that start, while solid outlines can be evaluated at any finite playback t.
`solids` can contain up to six bodies, identified by `body-1` etc. Flashes are
separate `wavefronts`; they do not acquire the velocity of an emitting body after
emission. Extra object parameters use `body2Type/Length/WidthRatio/BetaX/Y/Z/
OffsetX/Y/Z/EmissionTime` through body6; body 1 uses the original object fields.
`calculator` supplies both transformed abstract arrays and mapped cube vertices;
all returned arrays are snapshots. Only show `vectorNorm`/`tensorContraction`
for their respective scenarios; do not display the generic rod, twin or mirror
observables in calculators. Object velocity and width are independent of frame
velocity; generic `contractedLength=L/gamma(frame)` belongs only to the rod preset.

`sample().groundTime` and `.movingTime` describe the same event on x=0, not the
times of two spatially separate clocks. `properTime` describes the uniformly
moving frame-origin clock. `homeAge`/`travelerAge` are current chosen-slice ages
for twins and cap at reunion. Only show scenario-relevant observables to the tutor
and visible key. The generic simultaneityOffset uses the full ground separation L;
for the rod's actual measurement events the separation is L/γ instead.

## Implemented views on the shared kit

First view: two quiet linked x–ct plots, Ground and Moving, equal metric scales,
three stable colors (body blue, light warm white, selected event pale cyan).
Thin now line and faint 45-degree light cones; equations and numeric tables stay hidden.
Use a fixed viewport from all transformed scenario endpoints with 10% padding;
Reset restores it. Add one tiny key and a selected-event caption band, never
chasing labels. At narrow widths the two panels stack; both stay linked to the
same selected playback frame and timestamp. The normal
artifact/chat composer and shared transport remain the only playback controls.

An optional small spatial strip follows `geometry().objects` in the selected
frame. The transverse light clock needs its x–y strip: an x–ct projection alone
can conceal the photon's transverse travel. Do not infer photon speed from only
the projected x slope. No 3D decoration is needed.

Graphs (behind Graphs; implemented descriptor IDs):

| ID | View | Equation / meaning |
|---|---|---|
| `worldlines` | Selected worldline position against coordinate time, live cursor | x'=γ(x−vt), ct'=γ(ct−βx) |
| `clocks` | Coordinate and proper ages against the chosen time cursor | dτ=dt sqrt(1−u²/c²); twin age integrates each leg |
| `light-cone` | Equal-scale null rays through the selected event | c²Δt²−Δx²−Δy²=0; cone is a projection for transverse motion |
| `calibration` | Proper-distance/time calibration | (ct)²−x²=L²; core supplies the future timelike branch |
| `spatial` | xy or xyz object outline / flash front; optional x-y-ct worldtube | Rest offsets contract parallel to object velocity; flash radius = c(t−t_emit) in each frame |
| `four-vector` | Component arrow in selected projection, ground/moving pair | A'=ΛA; A_μ A^μ is invariant |
| `tensor` | Mapped hypercube or antisymmetric E/B-like arrows | T'=ΛTΛᵀ; mapped vertices expose projection geometry without DOS raster assets |

Two fixed scene chips, `event` (Zoom ? events) and `transform` (Zoom ? transform),
open magnified views and return through the kit's Full scene control. `event`
selects the following scenario-specific derivation; these rows name teaching
content, not additional chip IDs. `transform` shows the same selected event in
both frames, with live Lorentz equations. Object/flash/light-clock event views
show the spatial xy projection; calculators show vector or tensor projections.

| ID | Chip location | Equation and live quantities |
|---|---|---|
| `catch` | Gap between light and mirror | ct=L+vt ⇒ t=L/(c−v); show light and mirror distances separately |
| `return` | Reflection event | fixed source: t_total=2L/(c−v); comoving source: t_total=L/(c−v)+L/(c+v) |
| `light-clock` | Transverse mirrors | (cΔt/2)²=L²+(vΔt/2)² ⇒ Δt=γ(2L/c) |
| `simultaneity` | Pair of strike/door events | Δt'=γ(Δt−vΔx/c²); for ground-simultaneous strikes −γβL/c |
| `rod` | Rod endpoints | Δt=0 ⇒ L_ground=L_0/γ; measure endpoints on a horizontal now slice |
| `turnaround` | Traveler's corner | τ_traveler=2(L/c)/γ, τ_home=2L/c; changing frame changes simultaneity |
| `rocket` | Rocket launch | u=(u'+v)/(1+u'v/c²) |
| `object` | Finite outline | Δr_parallel=Δr_0,parallel/γ_u, Δr_transverse=Δr_0,transverse; compare simultaneous endpoints |
| `flash` | Emission event | c²(t−t_emit)²=|r−r_emit|² in either frame; emission itself transforms |
| `components` | Calculator caption | Transform one component, then show the invariant norm/contraction; tensor symmetry is preserved |

Breakdown starts hidden. Reveal one derivation line at a time: identify the chosen
frame, name each distance/time with units, mark the same events in both panels,
then substitute their coordinates into the relevant equation above. At catch-up,
ask which object moves each distance before showing the denominator. c−v is the
closing speed in the ground frame; it is **not** the measured photon speed in
the mirror frame. For twins, distinguish the single fixed boosted panel from the
traveler's changing outbound/inbound rest frames; that panel is not a global
traveler rest frame. Instantaneous turnaround is an idealized zero-duration limit.
Pole/barn shows event timing only, without claiming a rigid collision model.

Preset chips: Catch a mirror; Moving light clock · along x; Light clock · across y;
Train lightning; Measure a rod; Twin journey; Pole and barn; Launch a rocket;
Moving objects; Two light flashes; Four-vector; Rank-two tensor.
Each sets its entire reproducible scenario. No next-problem cards or lesson queue.

## Verification and workflow notes

`tests/experiments/minkowski.test.mjs` checks interval invariance/inverse boosts,
γ, both light-clock periods, proper ticks, rod endpoints, simultaneity, velocity
addition, both return arrangements, twin ages in both playback frames, now lines,
hyperbolas, barn timing, arbitrary-direction inverse boosts, all five body types,
oblique moving outlines, transverse width, spherical null flash sections,
four-vector/tensor symmetry and metric invariance, six independent mixed objects,
all presets and snapshot/reset/input boundaries. Each
analytic assertion names an absolute tolerance. Very large SI squared intervals
lose a few ulps under cancellation; the invariance test normalizes by c².

Sandbox Node child-process spawning returns EPERM for ordinary `node --test`.
Use Node 22's `--experimental-test-isolation=none` here; this still runs node:test.
The leading PowerShell profile also reports disabled execution scripts, so checks
use `login:false`. The public stage lacks private ARCHITECTURE/HANDOFF files;
those were read from the installed repository without changing it. These are
workflow friction observations for coordinator indexing, not app defects.
Full local originals resolved the web-reader truncation; the coverage evidence
now comes from complete files rather than menu declarations alone.

`manifest.json`, `view.js` and `drawing.js` now implement the Relativity gallery
entry, paired diagrams, spatial/calculator projections, contextual close-ups,
Breakdown, and custom graphs. Setup reveals at most twelve relevant fields;
advanced fields remain accessible to presets and validated tutor actions.
The projection views do not claim to be a rendered 3D worldtube.

The two view test files add descriptor consistency, fixed cameras, 45-degree
screen slopes (1e-9 px), finite drawing coordinates at narrow/wide sizes, equal-scale momentum-circle rendering (1e-9 px), and
scenario-scoped Setup checks to the 32 analytic core tests: 44 tests total.
Rendered browser evidence lives in `round-156/rel-views/browser.json` and adjacent
1280/320 PNG captures. It covers the actual gallery, transport, all presets,
Setup changes, close-up return, expanded view, equations, every graph and the
forbidden reaction state. These are hidden isolated-browser checks, not a real
phone/account or original DOS executable comparison. The coordinator owns the
independent visual judgment and final release integration.

Polish verification: gallery thumbnails draw apparatus without text; custom plots
keep zero and avoid padding past physical angle/speed/cosine domains. Incoming
momentum uses clearly visible dashed arrows even for forbidden reactions, without
inventing outgoing particles. The energy-budget bars and signed Q form one compact
group. Four additional view checks bring the lane to 44 passing tests.

Shared-convention pass: custom graphs use the shell title once; axes retain units
and names, with canvas minus signs typeset and numbers limited to four significant
figures. Panels clip strokes/markers to their drawing rectangles and reserve a
clear title band. Stacked scene panels retain at least 150 px in close-ups.
Relativity component labels sit by their own segment midpoints, avoid vector
strokes as well as other text, and disappear when coincident or too short. Narrow
views omit incoming-vector labels and the secondary angle label. Captions derive
from the actual outgoing particles rather than a fixed three-particle legend.
Finite Minkowski light journeys and twin reunions expose sample.ended in the
chosen coordinate frame; continuous uniform-motion scenarios remain open-ended.
Clock graphs request a five-period window. The lane has 47 passing Node tests;
rendered receipts remain in round-156/rel-views. Use the Kinema virtualenv for the
isolated fixture: the Panel virtualenv does not contain the app's fsrs dependency.

Desktop framing follow-up: Minkowski bounds use the actual events, with a small
negative-ct margin, while narrow bounds remain unchanged. Momentum frames use a
common scale derived from the current event and center their own occupied bounds;
the larger occupied span fills 70% of the smaller panel dimension. Desktop axes
use square plot boxes. Uniform angle changes are Setup changes, so these bounds
remain fixed during playback. Captions omit nonexistent incoming arrows and name
coincident/near-coincident threshold products together. The 280 MeV preset is
slightly above the exact threshold, so its caption says "near threshold".
Energy and momentum equations carry their units directly; normalized interval
wording says "in both S and S-prime". The lane now has 49 passing Node tests.
