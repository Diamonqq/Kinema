# Relativistic kinematics — physics and renderer brief

## CUPS capability research

Read original [RELKIN.HLP](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSNP/RELKIN/RELKIN.HLP)
and declarations/control portions of
[RELKIN.PAS](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSNP/RELKIN/RELKIN.PAS),
[RELSCAT](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSNP/RELKIN/RELSCAT.PAS),
[PSCAT12](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSNP/RELKIN/PSCAT12.PAS),
and [RELUTIL](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSNP/RELKIN/RELUTIL.PAS).
The program provides selectable incoming/decaying species and final reactions,
fixed-target collisions, momentum and CM-angle controls, lab/CM vector diagrams
and numerical tables, event-by-event stepping and automatic generation uniform in
CM cosθ, configurable scatter plots and histograms, particle data, energy/momentum
transfer/invariant-mass quantities, mass-width sampling and event-file output.
Original help lists selectable E, p, β, θ, cosθ, transverse momentum, kinetic
energy, angular difference and invariant mass for either daughter in either frame.
The coverage pass read the **complete local** RELKIN.HLP and RELSCAT.PAS in
`round-156/cups-src`. It also inspected the external
[REACTION.DAT](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSNP/RELKIN/REACTION.DAT)
and [PLOT.DAT](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSNP/RELKIN/PLOT.DAT)
lists. The earlier RELKIN/PSCAT12/RELUTIL web reads were partial, so uninspected
branches of those files are not claimed as checked. No original executable was
run, and no original code, prose or assets are incorporated.

This independently implemented core adds explicit teaching presets, exact
conservation diagnostics, a continuous angular locus, analytic thresholds and
Compton scattering, and actual three-body selected events for muons and pion
production. It now supplies all original selectable plot variables, seeded toy
samples and histograms. It does not reproduce arbitrary species databases,
mass-width sampling or legacy file export. A selected kinematically possible reaction
does not assert its probability or cross section.

## CUPS coverage

Status means headless physics/data; no plotted view or controls have been built
in this assignment. Channels below enumerate the actual REACTION.DAT entries;
some original choices are hypothetical, not experimentally observed decays.

| Original physics capability or plot | Kinema | Evidence / boundary |
|---|---|---|
| Fixed-target two-body collisions, selectable initial/final masses | Improved | `elastic`/`collision`, mass1..4, exact invariant energy, threshold diagnostic rather than a blank event. Resting target must be massive. |
| Two-body decays with parent momentum | Improved | `decay`, massless daughters allowed; either parent beta or inputMode=momentum. Daughter four-momenta conserve exactly up to floating-point residuals. |
| Beam momentum and single-event CM polar angle controls | Yes | `beamMomentum`, `inputMode`, `angle`; added kinetic-energy input with explicit units. Compton's single-event angle is explicitly lab photon angle. |
| Lab and CM momentum-vector diagrams | Yes | Initial/final four-momentum arrays in both frames, invariant mass, common exact reaction event. Rendered diagrams are follow-up work. |
| Numeric E,p,beta,angle, transverse p, KE, CM energy, available energy, transfer/invariant mass | Improved | `sample`, per-daughter geometry and `plotQuantity`; exposes conservation residuals too. Three-momentum transfer is frame dependent; four-transfer squared and pair mass are invariant. |
| Scatter plot with independently selected x/y variable, frame and daughter | Improved | `x/yVariable`, `x/yFrame`, `x/yParticle`; 1/2 original choices and 3 for our three-body events. Missing daughter returns unavailable plot, not invented zeroes. |
| Energy plot | Yes | `energy`, E in MeV. |
| Momentum magnitude plot | Yes | `momentum`, sqrt(px²+py²+pz²) in MeV/c. |
| Speed beta plot | Yes | `beta`, |p|/E in particle units. |
| Polar-angle plot | Yes | `theta`, arccos(px/|p|) in degrees; beam is +x. |
| Cosine-of-polar-angle plot | Yes | `cosTheta`; momentum zero has the stated convention cos=1, theta=0. |
| Transverse-momentum plot | Yes | `pT`, sqrt(py²+pz²). |
| Kinetic-energy plot | Yes | `kinetic`, E minus exact declared daughter rest mass, avoiding lightlike cancellation errors. |
| Theta difference / Lab opening angle plot | Improved | `openingAngle`, actual vector opening angle in the **selected** frame; for two daughters it agrees for either selection. Three-body extension compares selected daughter with the next cyclic daughter, explicitly a pair angle. |
| Final-state invariant-mass plot | Yes | `invariantMass`, sqrt((ΣE)²−|Σp|²) of all final daughters; not the sum of rest masses. |
| Four-momentum transfer t and three-momentum transfer q | Improved | `transferSquared` and `momentumTransfer` selectable in plots, from incoming particle 1 minus selected final particle. For decays this is a four-vector difference, not Mandelstam scattering t. |
| Histogram of the scatter plot's x variable | Improved | `scatter.histogram`, bounded bins, explicit edges, upper edge included, underflow/overflow counts. |
| Manual scatter/histogram limits | Improved | `plotRange=manual`, x/yMin/Max; validated ordered finite ranges, plus automatic ranges with constant-data padding. |
| Random uniform CM cos(theta) generation | Improved | `distribution=isotropic`, seeded reproducible bounded sample, eventCount 4..2048. Locus sampling is separate and labeled as a locus. Compton converts CM cosine to lab angle by aberration before evaluating recoil. |
| Single event versus automatic samples; event count / clearing | Yes | Selected event plus cached configured batch; recreate/reset snapshots instead of accumulating unbounded state. Time advances flight, not a hidden random-number clock. Automatic display pacing belongs to the kit. |
| Editable vector scale factors | Yes | Full momentum arrays/locus bounds supplied; view controls/scaling follow-up, no physics restriction. |
| Particle database: mass, lifetime, width, names; custom reaction file | Deliberately omitted | No imported particle database or file format. Fixed declared e, mu, p, pi0, charged pi masses plus custom masses cover Morin examples. Full species/branching catalogue belongs to later particle-physics work. Lifetime display would misleadingly imply lifetime simulation. |
| Nonzero-width random resonance mass (truncated Breit-Wigner helper) | Deliberately omitted | Fixed-mass on-shell teaching events keep threshold/conservation unambiguous. No resonance model, spectral weights or mass-width controls are claimed. |
| Event-file output | Deliberately omitted | Complete geometry/scatter snapshots are available to a future exporter; no DOS fixed-format files or export control in this physics-only pass. |
| MeV/GeV display toggle | Deliberately omitted | Canonical MeV units avoid ambiguous scaling; a renderer may format by 1000 without altering model data. |
| Default example: pion beam on proton, p=100 MeV/c, CM theta=30 degrees; Lab daughter-angle scatter/histogram | Improved | `Pion meets proton` preset implements the incoming event; axes remain independently selectable. To reproduce the original plot choose theta/lab/daughter1 vs theta/lab/daughter2. |

| Every original initial → final channel | Kinema | Treatment |
|---|---|---|
| e−+e+ → e−+e+ | Yes | Custom elastic with both masses `masses.electron`. No QED cross section claimed. |
| e−+p → e−+p | Yes | Custom elastic, electron/proton masses. |
| gamma+e → gamma+e | Improved | `compton` with closed-form shift, recoil conservation and boosted CM sample. |
| nu+e → nu+e | Yes | Custom elastic, mass1=0, mass2=electron; no weak-interaction weight. |
| nu+n → nu+n | Deliberately omitted | Neutron is absent from the named species catalogue; generic custom elastic supports entered masses. |
| mu+p → e+p | Deliberately omitted | Original toy conversion has no physical interaction model here; custom collision can explore the kinematics without labeling it a predicted process. |
| nu+p → nu+p | Yes | Custom elastic, mass1=0, mass2=proton. |
| n+p → n+p | Deliberately omitted | Named neutron channel absent; custom masses remain supported. |
| pi+p → pi+p | Improved | `pion-proton` and matching teaching preset. |
| pi+p → K0+Lambda | Deliberately omitted | No named K0/Lambda species or strangeness production preset; generic two-body threshold/mass model is available. |
| p+p → p+p | Yes | Custom elastic, both masses=proton. New pp→pppi0 supplies a real three-body threshold example. |
| eta → gamma gamma; mu mu; pi0 gamma | Deliberately omitted | No eta catalogue entry/presets; generic decay supports all three entered mass pairs. |
| charged K → pi pi0; mu nu | Deliberately omitted | No kaon catalogue entry/presets; generic decay supports entered masses. |
| K0 → pi pi; pi0 pi0; mu mu | Deliberately omitted | No K0 catalogue entry/presets; generic decay supports entered masses. |
| mu → e gamma | Deliberately omitted | Original toy LFV two-body channel is not the normal muon decay. Improved replacement is actual selected mu→e+nu+nu three-body kinematics at rest/in flight. No weak-decay spectrum. |
| charged pi → mu nu; e nu | Yes | Custom decay: parentMass=charged pion, mass1=muon/electron, mass2=0. Exact two-body machinery; no branching fraction. |
| pi0 → gamma gamma | Improved | Neutral-pion rest/flight presets, exact Doppler energies and invariant mass. |
| p → e+ pi0 | Deliberately omitted | Hypothetical proton-decay preset could teach an unobserved process as ordinary physics. Generic decay can still explore a declared toy hypothesis. |
| rho → pi pi | Deliberately omitted | No rho/resonance-width model or named preset. Fixed entered masses can be explored generically. |
| tau → pi nu | Deliberately omitted | No tau catalogue/preset; generic entered masses supported. |
| W → mu nu | Deliberately omitted | Beyond wave-one Morin scope; physical W mass also exceeds the explicit 10 GeV custom-parent range. |
| Z0 → e−e+; mu mu; tau tau | Deliberately omitted | Beyond scope; physical Z mass exceeds the declared custom-parent range. |

Original species names also include a null sentinel; it is not a physical
particle or extra decay mode. No unlisted external examples are assumed. Original
help's PART.DAT/REACT.DAT names differ from the repository's REACTION.DAT reader;
coverage follows the actual supplied sources and inspected channel file.

## Physics contract and units

The required `model` has parameter/unit/range descriptors, presets, observables,
and `create → {t,step,reset,sample,invariants,geometry}`. Parameters unrelated to
the chosen reaction should be hidden in Setup. Presets are reproducible from
defaults plus their values. No numerical integrator or external library is needed.

Particle units are explicitly MeV for E, MeV/c for momenta and MeV/c² for rest
masses. These are not SI momenta; never label a momentum arrow N·s. In formulas,
c=1 is a stated particle-unit convention. Spatial geometry `x,y,z` and playback
time remain SI metres and seconds, using exact c = 299792458 m/s.
The named helper exports are `C`, `H_C` (h*c in MeV m), `masses`,
`boostMomentum`, `sumMomentum`, `massSquared`, `invariantMass`, `twoBodyMomentum`,
`thresholdKinetic`, `comptonEnergy`, `plotVariables`, `plotQuantity`, `histogram`.

Masses are fixed textbook-scale numerical values, not live precision data:
electron 0.51099895, muon 105.6583755, proton 938.27208816, neutral pion 134.9768,
charged pion 139.57039
MeV/c². Source family for checking physical particle data:
[PDG summary tables](https://pdg.lbl.gov/2025/tables/contents_tables.html).
Tests use these declared constants and validate formulas independently.

Passive momentum boost: E'=γ(E−βp_x), p'_x=γ(p_x−βE), transverse components
unchanged. A negative boost carries CM daughters to the lab. `beta` is the parent
speed for decays. A collision calculates β_CM from the beam and resting target;
it does not use the decay-speed parameter. `kinetic` is incoming beam **kinetic**
energy, or full incident photon energy for Compton. `angle` is CM polar angle,
except Compton where it is the **lab scattered-photon** angle.
`inputMode=momentum` replaces kinetic input with lab beam momentum; for decays
the same parameter selects parent momentum and computes its beta. Presets reset
all declared parameters, including advanced plot controls, to reproducible values.

`geometry().lab` and `.cm` each contain initial and final four-momentum arrays.
Final records additionally contain straight-line SI positions at that frame's
coordinate t (v=c p/E). An instantaneous reaction occurs at the shared origin at
t=0; `step(dt)` advances freely propagating products exactly dt seconds. The two
position arrays are **frame-simultaneous slices**, not Lorentz transforms of the
same nonzero-time event. Momentum arrows are the main teaching view; optional
flight positions must not be misidentified as momentum components.

`locus` has 73 exact points sampled uniformly in CM cosine, including endpoints.
For two-body non-Compton modes this traces the
lab momentum ellipse from a CM circle. Three-body loci keep pair mass and
secondary rest-frame angle fixed. Compton now samples CM photon cosine and uses
cos(theta_lab)=(cos(theta_CM)+beta_CM)/(1+beta_CM cos(theta_CM)). This corrects
the first pass's lab-angle sampling for consistent CM distributions.
`scatter` has independent x/y axis descriptors, `{x,y,cosine}` points, ranges,
sample metadata and an x-variable histogram. A `locus` batch uses deterministic
CM cosine spacing. `isotropic` uses seeded uniform CM cosine samples; this is an
explicit **toy angular model**, not Klein-Nishina or a physical reaction rate.
Point count is not a cross section. The bounded batch/locus are computed once on
create and snapshots are copied on geometry(), not recomputed every animation
frame. `allowed=false` is a below-threshold state:
no outgoing arrows; balance residuals are zero placeholders and must be hidden.
Use `availableEnergy` (possibly negative) and the threshold explanation instead.
Threshold equality allows a 32-ulp energy comparison and clamps a slightly low
sqrt(s) to the required rest mass to avoid rounding-induced forbidden events.

Muon decay is μ→e+ν+ν with neutrino masses approximated zero. Sequential two-body
factorization picks a physical pair invariant mass via `pairFraction`, then splits
the neutrino pair in its own rest frame at `secondaryAngle`, before boosting all
three daughters. This is valid three-body kinematics, **not** the weak-interaction
Michel spectrum, lifetime decay, branching fractions or a two-body shortcut.
Proton-pion production similarly factors π⁰+(pp); p+p→p+p+π⁰ is a three-body
reaction and gets the correct fixed-target threshold. Both remain planar selected
events; orientation around the beam and event-weight sampling are follow-up scope.

## Implemented views on the shared kit

First view: two linked momentum diagrams, Lab and CM, with stable color per
daughter, subdued incoming arrow(s), and one compact caption showing sqrt(s).
Both diagrams use the same momentum scale and a fixed bound over the full angular
locus; Reset re-centers. Arrows start at the reaction vertex, avoiding spurious
position trajectories. No table, histogram, derivation, cone or extra toolbar at
entry. At 320 px the Lab/CM panels stack, preserving the chosen reaction/angle. The kit provides transport, Setup, Graphs, Breakdown.
An optional flight close-up uses physical v=c p/E; do not fake a slowing photon.

Graphs (behind Graphs; implemented descriptor IDs):

| ID | View | Equation / meaning |
|---|---|---|
| `flight` | Selected daughter position vs coordinate time, linked cursor | v_x/c=p_x/E; position is in light-seconds |
| `ellipse` | Lab p_parallel vs p_transverse with CM circle inset | ((p_x−γβE*)/(γp*))²+(p_y/p*)²=1 for fixed two-body masses |
| `energy-angle` | E_1 and E_2 vs CM cosθ (Compton: lab angle) | E_1=γ(E*_1+βp* cosθ*) |
| `threshold` | Available CM energy vs beam K | sqrt(s)=sqrt(m_a²+m_b²+2m_b(m_a+K)); Q=sqrt(s)−Σm_f |
| `invariant` | Total invariant mass in both frames | M²=E_total²−|p_total|²; annotate the same invariant value |
| `compton` | Outgoing photon energy vs lab angle | E'=E/[1+(E/m_e)(1−cosθ)] |
| `scatter` | Two selected quantities, independent frame and daughter per axis | E,p,beta,theta,cos(theta),pT,KE,pair opening angle,total invariant mass,transfer squared or magnitude |
| `histogram` | Counts of chosen x variable, only behind Graphs | Seeded uniform cos(theta*) toy sample; explicit bins and overflow; show sampling assumption beside plot |

Angle distributions are initially an **allowed kinematic locus**; use that label.
The optional implemented isotropic distribution samples uniform cosθ*, not uniform
θ*, and says it is a chosen angular model. The full Compton Klein–Nishina and muon
weak-decay weights are absent and must not be implied by a smooth curve.

Two implemented scene chips are `balance` (Zoom ? momentum) and `budget`
(Zoom ? energy). Balance magnifies the signed head-to-tail momentum sum; budget
magnifies the available invariant energy and daughter rest-energy requirement.
Breakdown adds signed component projections, the daughter polar angle, symbolic
and substituted equations. The table below maps further teaching content to
these two views and the Breakdown, rather than specifying seven extra chips.

| ID / chip location | Equation and live quantities |
|---|---|
| `balance` / vertex | ΣE_in=ΣE_out and Σp_in=Σp_out; head-to-tail momentum triangle, signed residuals |
| `boost` / between panels | E'=γ(E−βp_x), p'_x=γ(p_x−βE), p'_y=p_y; apply to one daughter at a time |
| `mass` / energy caption | M²=(ΣE)²−|Σp|², compare both frames; do not sum daughter masses as total invariant mass |
| `threshold` / incoming beam | K_th=[(Σm_f)²−(m_a+m_b)²]/(2m_b); ppπ⁰ gives 2m_π+m_π²/(2m_p) |
| `decay` / daughter pair | p*=sqrt([M²−(m_1+m_2)²][M²−(m_1−m_2)²])/(2M) |
| `recoil` / photon/electron vertex | Δλ=h/(m_ec)(1−cosθ), with electron momentum closing the triangle |
| `three-body` / neutrino or proton pair | q²=(p_2+p_3)²; M→particle 1 + pair(q), then pair→2+3 |

Breakdown is hidden initially. Start with the chosen incoming particles and frame,
then show one energy or momentum component, the conservation sum, and only then
the algebraic consequence. Units remain visible. Below threshold show the reason
and required kinetic energy instead of a fabricated event. Explain why lab beam
K is larger than new-particle rest energy: center-of-momentum motion still carries
energy. No probability-based statement follows from kinematic availability.

Preset chips: Pion at rest; Pion in flight; Equal masses; Make a pion; Photon recoil;
Muon at rest; Muon in flight; Pion meets proton. Custom two-body decay/reaction
remain Setup options. Keep plots, sampling options and numeric tables hidden at
entry; a complete capability inventory is not a mandate to show all controls.

## Verification / remaining work

`tests/experiments/rel-kinematics.test.mjs` checks four-vector boosts/invariants,
closed-form two-body momentum, pion photons, elastic/inelastic conservation in
both frames, fixed-target/general thresholds including exact and forbidden states,
Compton energy/wavelength shift and electron mass shell, three-body muon shells,
the kinematic ellipse, original pion/proton example, momentum input, every plot
variable/frame/daughter combination, invariant transfers, seeded CM distributions,
Compton aberration, histogram boundaries/overflow, preset finiteness, SI positions
and input/reset boundaries. Each analytic assertion states its tolerance. Together
with Minkowski there are 32 tests, including extreme declared mass/energy ranges.
Sandbox process spawning blocks ordinary `node --test` with EPERM;
`node --test --experimental-test-isolation=none tests/experiments/minkowski.test.mjs tests/experiments/rel-kinematics.test.mjs`
runs the actual checks in-process (Node 22).

`manifest.json` and `view.js` now implement gallery discovery, same-scale Lab/CM
momentum diagrams, both close-ups, eight graphs and live conservation equations.
Pure `eventFor(params)` supports cached angular sweeps without a playback seek.
All model descriptors are retained; Setup exposes only scenario-relevant fields.
Momentum diagrams describe reaction kinematics; they do not imply an interaction
force, a decay lifetime, or cross-section-weighted event generation.

The 44 core/view tests and isolated browser evidence are shared with the Minkowski
lane. `round-156/rel-views/browser.json` records actual checks and adjacent PNGs
show desktop, narrow, expanded and forbidden-state renders. See minkowski.md for
verification scope and shared workflow friction. No installed app or real-device
check was performed.

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
