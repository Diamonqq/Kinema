# Race track — physics and renderer brief

## Original capability research

Read [GMRACE.PAS](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GMRACE.PAS),
[GENMOT.HLP](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GENMOT.HLP)
and GMUTIL1/2, both DOS and SDL (2026-10-23). Original race physics is a free
2-D particle driven by independently adjustable Cartesian forces, linear damping,
and mass. Arrow keys increment the applied force components; kinetic energy is
available. The drawn course has two straight sections and semicircular ends;
the implementation stops outside broad rectangular bounds and on a finish-line
crossing. It is not a tyre-friction or banked-road model. Generic help offers
editable state/forces/numerics, linked configurable plots and saved configurations;
it contains no dedicated Race Track section. No code or prose is copied.

## CUPS coverage

Full supplied local HLP/GMGENER/GMRACE copies were read. “Improved” refers to
implemented headless physics; rendering remains the brief below.

| Capability | Kinema | Evidence / reason |
|---|---|---|
| Straight-plus-semicircle oval course | improved | Editable radius/straight length; continuous SI position and tangent |
| Editable mass, initial speed and applied force | improved | Drive/braking demand constrained by actual tyre grip |
| Arrow-controlled independent x/y thrust | omitted | Deliberate guided-lap cornering lab; no free-force steering game in this pass |
| Free off-course trajectory / broad boundary stop | omitted | Valid rolling model ends at grip failure; no post-slip simulation claimed |
| Linear velocity damping | omitted | Replaced by explicit quadratic air resistance and rolling loss, not the original damping law |
| Kinetic energy | improved | Signed drive/brake work and dissipated-energy bookkeeping |
| Applied-force vector display | improved | Model supplies signed normal/friction/weight components; view to follow |
| Finish-line crossing | improved | Route-distance validated lap count and first lap time, not any x crossing |
| Banking, corner speed limits and shared tyre budget | improved | New tested force decomposition and friction-circle model |
| Editable state/forces while continuing | omitted | Setup resets deterministically; in-run steering and recovery not authored |
| RK4/Euler/RK2 and numerical step controls | improved / omitted | RK4 with event location; solver selection omitted from product controls |
| Arbitrary graphs / movable duplicate windows | omitted | Curated linked graph design below; shared renderer responsibility |
| Save/load configuration and user help text | omitted | Shared app persistence and tutor, no core file I/O |
| Export last 500 numerical time steps with parameters | omitted | Snapshot API supplies data; export UI/file format deferred to shared kit |
| Arbitrary trajectory retention | omitted | No history overlay in this core pass; shared kit may add comparisons later |

## New model and explicit boundary

The new experiment is a **guided-lap cornering laboratory**, not the original
Cartesian thrust game. Track is a stadium with corner radius r and half straight
length L; circumference is 4L+2 pi r. L=0 makes a circle. Position/tangent are
continuous at joins; curvature changes instantly (an idealized track).

- Car follows the centerline only while the demanded lateral tyre force is
  physically possible. First loss of grip **ends valid motion**. State and energy
  freeze there; `lostGrip=true`, `validLap=false`; clock t still advances exactly
  dt, while `activeTime` stops. This pass deliberately has no invented skid,
  steering/recovery, rollover, road width, wheel or suspension dynamics. The view
  must say “Grip exceeded · reset or change setup”, not draw a completed corner.
- Banking applies to curved sections; centerline height is constant. Normal
  force N and signed slope-tangent friction f satisfy both Newton components:
  **N sin(theta)+f cos(theta)=mv²/r**, **N cos(theta)-f sin(theta)=mg**.
  Thus N=m(g cos(theta)+(v²/r)sin(theta));
  f=m((v²/r)cos(theta)-g sin(theta)). Positive f is downhill/inward; slow cars on
  steep banks need negative uphill/outward friction. Show its reversal.
- Tyre budget: **sqrt(f_lateral²+f_longitudinal²) <= mu N**. Requested drive
  or braking force is clipped to the remaining circle radius. Show actual and
  requested force separately; excess lateral demand is never silently capped
  while pretending the car remains on its route.
- Coast losses: air = c v² and rolling = c_r N for forward motion; no reversal
  under braking. Signed drive/braking work W and dissipated work D are integrated
  alongside speed and route distance: **K + D - W = K_initial**. No extra loss
  from static cornering friction. Translational point-mass energy only.
- RK4 <=0.005 s, bisection for stop/grip/lap events. First valid lap time is
  recorded, zero before completion (renderer displays a dash). Lap count is
  distance / circumference. Reset restores exact initial state.
- Pure helpers `curveForces`, `speedLimits`, `trackPoint`, `resolve` support
  close-ups and analytic checks. Speed limits assume zero longitudinal force:
  **v_max²=rg(tan(theta)+mu)/(1-mu tan(theta))**;
  **v_min²=max(0,rg(tan(theta)-mu)/(1+mu tan(theta)))**.
  Ideal no-friction speed: **v_ideal²=rg tan(theta)**. UI parameter limits keep
  denominators positive. Static coefficients, no downforce/tyre heating/load transfer.

## Exact shared-kit view brief

Quiet first view: fixed, proportional top-down stadium and car with a subtle
velocity trail, a small speed caption and one compact key. Physical car 4.5 x 1.8 m;
use a halo for hit target on large tracks. No force arrows or scene-following
labels. Fixed bounds x=[-L-r,L+r], y=[-r,r] plus road/caption padding.
One unobtrusive “Zoom · corner” chip beside the next curve. At loss of grip,
freeze at the actual limit position and show the short status above transport.

Preset chips: **Flat corner** (friction supplies inward force), **Banked corner**
(nearly friction-free design speed), **Ice loses grip** (insufficient lateral
grip), **Brake while turning** (shared friction circle), **Tighter curve**
(radius changes acceleration), **Coast to a stop** (energy becomes heat).
No lap score, points, streak or celebratory completion UI.

Close-ups:

- `corner` / “Zoom · corner”: cross-section looking along the velocity; car on
  bank with theta visibly between road and horizontal. Vertical mg, road-normal
  N, signed slope-tangent f; horizontal inward axis points to center. Reveal
  projections only in Breakdown: **N sin(theta)+f cos(theta)=mv²/r** above
  **N cos(theta)-f sin(theta)=mg**. Fixed caption bands show force values in N.
  The normal tilts **toward** the curve center; friction arrow reverses below
  ideal speed. In a straight, explicitly label that cross-section “flat straight”.
- `grip` / “Zoom · tyre grip”: circle of radius mu N, horizontal longitudinal
  force and vertical lateral force, resultant dot inside/on/outside. Equation
  **f_parallel²+f_perp² <= (mu N)²**. Show requested drive as a hollow dot and
  actual clipped drive as solid; red only for impossible lateral demand.
- `radius` / “Zoom · radius”: car, radius vector to center and perpendicular
  velocity; **a_in=v²/r** with live values. No fake centripetal force arrow in
  addition to N and friction; their resultant is the net inward force.

Graphs behind Graphs, time cursor shared with scene:

| id | series (units) | purpose |
|---|---|---|
| speed | speed, cornerMaxSpeed, cornerMinSpeed (m/s) | available corner window |
| grip | lateralFriction, longitudinalFriction, frictionCapacity (N) | shared tyre budget |
| energy | energy, dissipatedWork, driveWork, accountedEnergy (J) | energy ledger |
| lap | distance (m), activeTime (s) in separate unit panes | distance and valid lap timing |

On straights, label the graphed bounds **next corner limits**, never current
straight-line speed limits. Breakdown includes geometry (inward vs forward),
the two force balances, signed friction, grip circle, instantaneous acceleration,
and energy ledger. Show only the opened idea. At 320 px prioritize cross-section
and equation; graph and close-up are one pane at a time, controls above composer.

## Verification and integration limits

`node --experimental-test-isolation=none --test tests/experiments/race-track.test.mjs`
checks speed-limit equations, both force balances, friction circle clipping,
oval continuity, exact coasting lap, initial/entry loss of grip, quadratic drag
closed form, energy ledgers, braking stop, finite presets/reset and rejection.
Numeric checks state tolerances. No view.js/manifest or rendered-screen claim in
this pass. Lead owns shared registration/version when integrating views.

Workflow suggestions for coordinator: preserve explicit source-vs-new-model
distinction (the referenced HLP has no named projectile/race chapters), and use
single-process Node tests where child spawn is EPERM. These are lane-scoped notes;
coordinator can reconcile them with existing work_records.
