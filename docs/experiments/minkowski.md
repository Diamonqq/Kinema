# Minkowski diagrams — physics and renderer brief

## CUPS capability research

Read the exposed declarations/menu portions of the original
[SPECREL](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SPECREL.PAS),
[SRMINKX](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SRMINKX.PAS),
[SROBJ1](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SROBJ1.PAS),
[SROBJ2](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SROBJ2.PAS),
[OBJECTS](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/OBJECTS.PAS),
and [SRLIST](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSMP/SPECREL/SRLIST.PAS).
These establish two independently selectable frame/graph panels (xt, xy, xyt,
xyz), optional worldlines, editable rods, rockets, flashes, balls, rectangles and
barns, forward/inverse Lorentz transforms, four-vector and tensor calculators,
and saved configurations. The web reader truncates long Pascal files; the original
executable and all implementation branches were not inspected or run. Its help is
embedded in SRMINKX; a separate SPECREL.HLP URL does not exist. No original source
code, assets or prose are incorporated here.

This core adds exact, named teaching scenarios, consistent linked simultaneity
slices, analytic light interception/reflection, proper-time ticks, invariant
calibration curves and tests. It intentionally does not implement the original
arbitrary 3D object editor or general tensor calculator.

## Model and units

`model.js` exports the required `model` descriptors and instance API. Named utility
exports are `C`, `gamma`, `boost`, `interval`, `addVelocity`. Coordinates are metres
and seconds with exact SI c = 299792458 m/s; plot vertical **ct in metres** with
equal x/ct scale so light is at 45 degrees. Never label a time axis ct while
feeding it seconds. Boost is passive: x' = γ(x−vt), t' = γ(t−vx/c²), y'=y.

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

`sample().groundTime` and `.movingTime` describe the same event on x=0, not the
times of two spatially separate clocks. `properTime` describes the uniformly
moving frame-origin clock. `homeAge`/`travelerAge` are current chosen-slice ages
for twins and cap at reunion. Only show scenario-relevant observables to the tutor
and visible key. The generic simultaneityOffset uses the full ground separation L;
for the rod's actual measurement events the separation is L/γ instead.

## Views to build on the kit (not rendered in this pass)

First view: two quiet linked x–ct plots, Ground and Moving, equal metric scales,
three stable colors (body blue, light warm white, selected event pale cyan).
Thin now line; no cones, tick labels, equations or full numeric tables initially.
Use a fixed viewport from all transformed scenario endpoints with 10% padding;
Reset restores it. Add one tiny key and a selected-event caption band, never
chasing labels. On 320 px show one plot with Ground/Moving tabs; keep both data
sets linked to the same selected playback frame and timestamp. The normal
artifact/chat composer and shared transport remain the only playback controls.

An optional small spatial strip follows `geometry().objects` in the selected
frame. The transverse light clock needs its x–y strip: an x–ct projection alone
can conceal the photon's transverse travel. Do not infer photon speed from only
the projected x slope. No 3D decoration is needed.

Graphs (behind Graphs; IDs for the later renderer):

| ID | View | Equation / meaning |
|---|---|---|
| `worldlines` | Linked frame plots and now line | x'=γ(x−vt), ct'=γ(ct−βx) |
| `clocks` | Coordinate and proper ages against the chosen time cursor | dτ=dt sqrt(1−u²/c²); twin age integrates each leg |
| `light-cone` | Equal-scale null rays through the selected event | c²Δt²−Δx²−Δy²=0; cone is a projection for transverse motion |
| `calibration` | Proper-distance/time calibration | (ct)²−x²=L²; core supplies the future timelike branch |

Close-ups: scene chips must be obvious, stay fixed near their subject, and return
to the full view using the kit's Back control.

| ID | Chip location | Equation and live quantities |
|---|---|---|
| `catch` | Gap between light and mirror | ct=L+vt ⇒ t=L/(c−v); show light and mirror distances separately |
| `return` | Reflection event | fixed source: t_total=2L/(c−v); comoving source: t_total=L/(c−v)+L/(c+v) |
| `light-clock` | Transverse mirrors | (cΔt/2)²=L²+(vΔt/2)² ⇒ Δt=γ(2L/c) |
| `simultaneity` | Pair of strike/door events | Δt'=γ(Δt−vΔx/c²); for ground-simultaneous strikes −γβL/c |
| `rod` | Rod endpoints | Δt=0 ⇒ L_ground=L_0/γ; measure endpoints on a horizontal now slice |
| `turnaround` | Traveler's corner | τ_traveler=2(L/c)/γ, τ_home=2L/c; changing frame changes simultaneity |
| `rocket` | Rocket launch | u=(u'+v)/(1+u'v/c²) |

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
Train lightning; Measure a rod; Twin journey; Pole and barn; Launch a rocket.
Each sets its entire reproducible scenario. No next-problem cards or lesson queue.

## Verification and workflow notes

`tests/experiments/minkowski.test.mjs` checks interval invariance/inverse boosts,
γ, both light-clock periods, proper ticks, rod endpoints, simultaneity, velocity
addition, both return arrangements, twin ages in both playback frames, now lines,
hyperbolas, barn timing, all presets and snapshot/reset/input boundaries. Each
analytic assertion names an absolute tolerance. Very large SI squared intervals
lose a few ulps under cancellation; the invariance test normalizes by c².

Sandbox Node child-process spawning returns EPERM for ordinary `node --test`.
Use Node 22's `--experimental-test-isolation=none` here; this still runs node:test.
The leading PowerShell profile also reports disabled execution scripts, so checks
use `login:false`. The public stage lacks private ARCHITECTURE/HANDOFF files;
those were read from the installed repository without changing it. These are
workflow friction observations for coordinator indexing, not app defects.

No view.js or manifest is authored in this physics-only pass; gallery discovery
and desktop/320/expanded rendered checks belong to the assigned follow-up.
