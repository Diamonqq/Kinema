# Relativistic kinematics — physics and renderer brief

## CUPS capability research

Read original [RELKIN.HLP](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSNP/RELKIN/RELKIN.HLP)
and exposed declarations/control portions of
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
Long web source/help responses are truncated; original execution and complete
implementation coverage are unverified. No original code, prose or assets copied.

This independently implemented core adds explicit teaching presets, exact
conservation diagnostics, a continuous angular locus, analytic thresholds and
Compton scattering, and actual three-body selected events for muons and pion
production. It does not yet reproduce arbitrary species databases, mass-width
sampling, MC statistics or data export. A selected kinematically possible reaction
does not assert its probability or cross section.

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
`thresholdKinetic`, `comptonEnergy`.

Masses are fixed textbook-scale numerical values, not live precision data:
electron 0.51099895, muon 105.6583755, proton 938.27208816, neutral pion 134.9768
MeV/c². Source family for checking physical particle data:
[PDG summary tables](https://pdg.lbl.gov/2025/tables/contents_tables.html).
Tests use these declared constants and validate formulas independently.

Passive momentum boost: E'=γ(E−βp_x), p'_x=γ(p_x−βE), transverse components
unchanged. A negative boost carries CM daughters to the lab. `beta` is the parent
speed for decays. A collision calculates β_CM from the beam and resting target;
it does not use the decay-speed parameter. `kinetic` is incoming beam **kinetic**
energy, or full incident photon energy for Compton. `angle` is CM polar angle,
except Compton where it is the **lab scattered-photon** angle.

`geometry().lab` and `.cm` each contain initial and final four-momentum arrays.
Final records additionally contain straight-line SI positions at that frame's
coordinate t (v=c p/E). An instantaneous reaction occurs at the shared origin at
t=0; `step(dt)` advances freely propagating products exactly dt seconds. The two
position arrays are **frame-simultaneous slices**, not Lorentz transforms of the
same nonzero-time event. Momentum arrows are the main teaching view; optional
flight positions must not be misidentified as momentum components.

`locus` has 73 exact points sampled uniformly in cos of the selected angular
variable, including endpoints. For two-body non-Compton modes this traces the
lab momentum ellipse from a CM circle. Three-body loci keep pair mass and
secondary rest-frame angle fixed. Compton samples lab photon angle, not CM angle.
No physical angular density is supplied. Rendering a histogram with these points
as event frequencies would be wrong. `allowed=false` is a below-threshold state:
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

## Views to build on the kit (not rendered in this pass)

First view: two linked momentum diagrams, Lab and CM, with stable color per
daughter, subdued incoming arrow(s), and one compact caption showing sqrt(s).
Both diagrams use the same momentum scale and a fixed bound over the full angular
locus; Reset re-centers. Arrows start at the reaction vertex, avoiding spurious
position trajectories. No table, histogram, derivation, cone or extra toolbar at
entry. On 320 px use Lab/CM tabs and one readable diagram; frame changes preserve
the chosen reaction/angle. The kit provides transport, Setup, Graphs, Breakdown.
An optional flight close-up uses physical v=c p/E; do not fake a slowing photon.

Graphs (behind Graphs; IDs for the later renderer):

| ID | View | Equation / meaning |
|---|---|---|
| `ellipse` | Lab p_parallel vs p_transverse with CM circle inset | ((p_x−γβE*)/(γp*))²+(p_y/p*)²=1 for fixed two-body masses |
| `energy-angle` | E_1 and E_2 vs CM cosθ (Compton: lab angle) | E_1=γ(E*_1+βp* cosθ*) |
| `threshold` | Available CM energy vs beam K | sqrt(s)=sqrt(m_a²+m_b²+2m_b(m_a+K)); Q=sqrt(s)−Σm_f |
| `invariant` | Total invariant mass in both frames | M²=E_total²−|p_total|²; annotate the same invariant value |
| `compton` | Outgoing photon energy vs lab angle | E'=E/[1+(E/m_e)(1−cosθ)] |

Angle distributions are initially an **allowed kinematic locus**; use that label.
Any later isotropic test distribution must sample uniform cosθ*, not uniform θ*,
and say it is a chosen angular model. The full Compton Klein–Nishina and muon
weak-decay weights are absent and must not be implied by a smooth curve.

Close-ups and Breakdown content:

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
Muon at rest; Muon in flight. Custom two-body decay/reaction remain Setup options.

## Verification / remaining work

`tests/experiments/rel-kinematics.test.mjs` checks four-vector boosts/invariants,
closed-form two-body momentum, pion photons, elastic/inelastic conservation in
both frames, fixed-target/general thresholds including exact and forbidden states,
Compton energy/wavelength shift and electron mass shell, three-body muon shells,
the kinematic ellipse, preset finiteness, SI positions and input/reset boundaries.
Each analytic assertion states its tolerance. Together with Minkowski there are
21 tests, including extreme declared mass/energy ranges. Sandbox process spawning blocks ordinary `node --test` with EPERM;
`node --test --experimental-test-isolation=none tests/experiments/minkowski.test.mjs tests/experiments/rel-kinematics.test.mjs`
runs the actual checks in-process (Node 22).

No manifest/view or app wiring is authored here. The follow-up owns rendered
desktop/320/expanded checks, normal navigation and honest reaction error states.
The coordinator should index the shared friction noted in minkowski.md once.
