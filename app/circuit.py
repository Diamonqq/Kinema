"""Circuits: a standard-symbol schematic plus an independent DC solution.

The model writes the netlist and where the nodes sit on a grid; the browser draws proper symbols
(static/js/circuit.js). Here the setup is validated and, for DC analyses, solved by modified nodal analysis,
so the model's currents and voltages are compared against a calculation the model did not make.
Conventions: every two-terminal element has terminals a and b; current_ab flows from a to b THROUGH the
element; voltage_ab = V(a) - V(b); power = voltage_ab * current_ab (positive = absorbed).
battery: b is the + terminal (V(b) - V(a) = value). current_source: pushes `value` amperes from a to b through
itself. analysis 'dc' = long-time steady state (capacitors open, inductors shorted); 'initial' = the instant
after a switch closes with uncharged capacitors (shorted) and unenergized inductors (open).
"""
from __future__ import annotations

import math
import re

TYPES = ["resistor", "capacitor", "inductor", "battery", "current_source", "ac_source", "switch_open", "switch_closed",
         "lamp", "ammeter", "voltmeter", "diode", "wire", "ground"]
VALUE_UNITS = {"resistor": "Ω", "lamp": "Ω", "capacitor": "F", "inductor": "H", "battery": "V", "ac_source": "V",
               "current_source": "A"}
ANALYSES = ["dc", "initial", "none"]
QUANTITIES = ["current", "voltage", "power"]

N = {"type": "number"}
NN = {"type": ["number", "null"]}
S = {"type": "string"}
NS = {"type": ["string", "null"]}


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


CIRCUIT_SCHEMA = _obj({
    "nodes": {"type": "array", "items": _obj({"id": S, "x": N, "y": N})},
    "components": {"type": "array", "items": _obj({"id": S, "type": {"type": "string", "enum": TYPES}, "a": S, "b": NS,
                                                     "value": NN, "label": S})},
    "analysis": {"type": "string", "enum": ANALYSES},
    "show_currents": {"type": "boolean"},
    "checks": {"type": "array", "items": _obj({"label": S, "quantity": {"type": "string", "enum": QUANTITIES},
                                                "component": S, "expect": N, "tol_pct": N})},
})

PROMPT = r"""circuit SPEC (a schematic the app draws with standard symbols and, for DC, solves itself):
- nodes: {id, x, y} on a grid (y up), integer or half-integer coordinates, about 1-2 units apart. Lay the
  circuit out like a textbook: a rectangular loop, sources on the left, parallel branches side by side. Every
  corner of a wire is a node.
- components: {id, type, a, b, value, label}: a two-terminal element drawn straight from node a to node b.
  Keep each component horizontal or vertical. types: resistor (ohm), capacitor (F), inductor (H), battery (V;
  b is the + terminal), current_source (A, pushes current from a to b through itself), ac_source (V amplitude;
  drawn only), switch_open, switch_closed, lamp (ohm), ammeter (ideal, 0 ohm), voltmeter (ideal, open),
  diode (drawn only; a = anode), wire (a plain connection), ground (one node: a; b = null). value null when
  symbolic or irrelevant. label as printed: "R_1 = 4 Ω", "C", "12 V", "S".
- analysis: dc (steady state: capacitors open, inductors short), initial (just after closing a switch:
  uncharged capacitors short, inductors open), none (draw only: symbolic values, AC, diodes, transients).
- checks: {label, quantity: current | voltage | power, component, expect, tol_pct <= 3} for values you computed.
  Give magnitudes (a positive expected value matches either direction; a negative one must match the a-to-b
  sign). The app solves the circuit independently. All ground symbols are one node.
- For RC/RL transients use a plot for V(t) or I(t) and put the circuit in the caption/steps, or draw the circuit
  with analysis none; a circuit cannot show time dependence.
"""


class CircuitError(ValueError):
    pass


def _num(value, name: str, lo: float = -1e12, hi: float = 1e12) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        raise CircuitError(f"{name}: expected a finite number in {lo:g}..{hi:g}")
    return float(value)


def validate(spec: dict) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    nodes = spec.get("nodes")
    comps = spec.get("components")
    if not isinstance(nodes, list) or not 2 <= len(nodes) <= 80:
        raise CircuitError("circuit needs 2 to 80 nodes")
    if not isinstance(comps, list) or not 1 <= len(comps) <= 80:
        raise CircuitError("circuit needs 1 to 80 components")
    ids = set()
    pos = {}
    for n in nodes:
        nid = n.get("id")
        if not isinstance(nid, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,40}", nid) or nid in ids:
            raise CircuitError(f"node {nid!r}: invalid or duplicate id")
        ids.add(nid)
        pos[nid] = (_num(n.get("x"), f"node {nid}.x", -500, 500), _num(n.get("y"), f"node {nid}.y", -500, 500))
    if len(set(pos.values())) != len(pos):
        raise CircuitError("two nodes share one position")
    cids = set()
    for c in comps:
        cid, ctype = c.get("id"), c.get("type")
        if not isinstance(cid, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,40}", cid) or cid in cids:
            raise CircuitError(f"component {cid!r}: invalid or duplicate id")
        cids.add(cid)
        if ctype not in TYPES:
            raise CircuitError(f"component {cid}: unknown type {ctype!r}")
        if c.get("a") not in ids:
            raise CircuitError(f"component {cid}: terminal a is not a node")
        if ctype == "ground":
            if c.get("b") not in (None, "", c.get("a")):
                raise CircuitError(f"ground {cid}: connects to one node (b = null)")
        else:
            if c.get("b") not in ids or c.get("b") == c.get("a"):
                raise CircuitError(f"component {cid}: terminal b must be a different node")
            (x1, y1), (x2, y2) = pos[c["a"]], pos[c["b"]]
            if abs(x1 - x2) > 1e-9 and abs(y1 - y2) > 1e-9:
                warnings.append(f"{cid} is drawn diagonally; lay components out horizontally or vertically.")
        if c.get("value") is not None:
            _num(c.get("value"), f"component {cid}.value")
    analysis = spec.get("analysis")
    if analysis not in ANALYSES:
        raise CircuitError("analysis: dc, initial or none")
    checks = spec.get("checks") or []
    if len(checks) > 16:
        raise CircuitError("checks: at most 16")
    for i, chk in enumerate(checks):
        if chk.get("component") not in cids:
            raise CircuitError(f"checks[{i}]: unknown component")
        if chk.get("quantity") not in QUANTITIES:
            raise CircuitError(f"checks[{i}]: quantity must be current, voltage or power")
        _num(chk.get("expect"), f"checks[{i}].expect")
    solution = None
    if analysis != "none":
        try:
            solution = solve(spec)
        except CircuitError as exc:
            warnings.append(f"The app could not solve this circuit independently: {exc}")
    out = dict(spec)
    out["solution"] = solution
    out["check_results"] = compare(checks, solution) if solution else []
    return out, warnings


def _gauss(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-13:
            raise CircuitError("the equations are singular (an ideal source is shorted, or a loop of ideal sources)")
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r != col and m[r][col] != 0:
                f = m[r][col] / m[col][col]
                for k in range(col, n + 1):
                    m[r][k] -= f * m[col][k]
    return [m[i][n] / m[i][i] for i in range(n)]


def solve(spec: dict) -> dict:
    """Modified nodal analysis of the resistive network the analysis implies."""
    analysis = spec["analysis"]
    comps = spec["components"]
    node_ids = [n["id"] for n in spec["nodes"]]
    grounds = {c["a"] for c in comps if c["type"] == "ground"}
    ground = next((c["a"] for c in comps if c["type"] == "ground"), None)
    if ground is None:
        ground = next((c["a"] for c in comps if c["type"] == "battery"), node_ids[0])
    grounds.add(ground)                            # several ground symbols are one node (review 0.5)
    index = {nid: i for i, nid in enumerate(n for n in node_ids if n not in grounds)}
    n = len(index)
    conductances, sources, currents, shorts, opens, skipped = [], [], [], [], [], []
    for c in comps:
        t, v = c["type"], c.get("value")
        if t == "ground":
            continue
        if t in ("resistor", "lamp"):
            if v is None or v <= 0:
                raise CircuitError(f"{c['id']} needs a positive resistance to be solved")
            conductances.append((c, 1.0 / v))
        elif t == "battery":
            if v is None:
                raise CircuitError(f"{c['id']} needs a voltage to be solved")
            sources.append((c, v))
        elif t == "current_source":
            if v is None:
                raise CircuitError(f"{c['id']} needs a current to be solved")
            currents.append((c, v))
        elif t in ("wire", "ammeter", "switch_closed"):
            sources.append((c, 0.0))
            shorts.append(c["id"])
        elif t == "capacitor":
            (sources.append((c, 0.0)) or shorts.append(c["id"])) if analysis == "initial" else opens.append(c["id"])
        elif t == "inductor":
            (sources.append((c, 0.0)) or shorts.append(c["id"])) if analysis == "dc" else opens.append(c["id"])
        elif t in ("voltmeter", "switch_open"):
            opens.append(c["id"])
        else:                                    # ac_source, diode
            raise CircuitError(f"{t.replace('_', ' ')} {c['id']} cannot be solved as a DC network")
    size = n + len(sources)
    if size == 0:
        raise CircuitError("nothing to solve")
    A = [[0.0] * size for _ in range(size)]
    z = [0.0] * size
    gmin = 1e-12                                   # keeps floating nodes (open branches) solvable

    def idx(node):
        return index.get(node)

    for i in range(n):
        A[i][i] += gmin
    for c, g in conductances:
        a, b = idx(c["a"]), idx(c["b"])
        if a is not None:
            A[a][a] += g
        if b is not None:
            A[b][b] += g
        if a is not None and b is not None:
            A[a][b] -= g
            A[b][a] -= g
    for c, amps in currents:
        a, b = idx(c["a"]), idx(c["b"])      # current leaves node a into the source and exits at b
        if a is not None:
            z[a] -= amps
        if b is not None:
            z[b] += amps
    for k, (c, volts) in enumerate(sources):
        row = n + k
        a, b = idx(c["a"]), idx(c["b"])
        # unknown j_k = current from a to b through the element; V(b) - V(a) = volts
        if a is not None:
            A[a][row] += 1.0
            A[row][a] -= 1.0
        if b is not None:
            A[b][row] -= 1.0
            A[row][b] += 1.0
        z[row] = volts
    x = _gauss(A, z)
    # gmin keeps open branches solvable; a current source with no DC path would instead be "solved" at ~1e12 V
    # no real node voltage exceeds the sources' voltages plus their currents through every resistance
    bound = 1.0 + sum(abs(v) for _, v in sources) + sum(abs(a) for _, a in currents) * sum(1.0 / g for _, g in conductances)
    if n and max(abs(v) for v in x[:n]) > 1e3 * bound:
        raise CircuitError("a current source has no DC path (for example in series with a capacitor in steady state): no steady state exists")
    volt = {**{g: 0.0 for g in grounds}, **{nid: x[i] for nid, i in index.items()}}
    result = {}
    for c in comps:
        if c["type"] == "ground":
            continue
        va, vb = volt[c["a"]], volt[c["b"]]
        vab = va - vb
        if any(c is s for s, _ in sources):
            k = next(i for i, (s, _) in enumerate(sources) if s is c)
            iab = x[n + k]
        elif any(c is s for s, _ in conductances):
            iab = vab * next(g for s, g in conductances if s is c)
        elif any(c is s for s, _ in currents):
            iab = next(a for s, a in currents if s is c)
        else:
            iab = 0.0
        result[c["id"]] = {"current": _clean(iab), "voltage": _clean(vab), "power": _clean(vab * iab)}
    return {"analysis": analysis, "ground": ground, "node_voltages": {k: _clean(v) for k, v in volt.items()},
            "components": result, "shorted": shorts, "open": opens}


def _clean(v: float) -> float:
    return 0.0 if abs(v) < 1e-12 else float(f"{v:.12g}")


def compare(checks: list[dict], solution: dict) -> list[dict]:
    out = []
    for chk in checks:
        got = (solution["components"].get(chk["component"]) or {}).get(chk["quantity"])
        raw_tol = chk.get("tol_pct")
        tol = max(0.1, min(3.0, float(3 if raw_tol is None else raw_tol))) / 100      # 0 % would fail on rounding
        expect = float(chk["expect"])
        if got is None:
            status = "na"
        else:
            allowed = tol * max(abs(expect), 1e-9)
            status = "ok" if abs(got - expect) <= allowed else "sign" if abs(abs(got) - abs(expect)) <= allowed else "bad"
            # a magnitude is what textbooks usually ask for; direction conventions differ
            if status == "sign" and expect >= 0:
                status = "ok"
        out.append({**chk, "got": got, "status": status})
    return out


def example_divider() -> dict:
    """A 12 V battery with R1 = 4 ohm in series with (R2 = 6 ohm || R3 = 3 ohm): I = 2 A, V(R2) = 4 V."""
    nodes = [{"id": "n1", "x": 0, "y": 0}, {"id": "n2", "x": 0, "y": 2}, {"id": "n3", "x": 2, "y": 2},
             {"id": "n4", "x": 4, "y": 2}, {"id": "n5", "x": 4, "y": 0}, {"id": "n6", "x": 2, "y": 0},
             {"id": "n7", "x": 6, "y": 2}, {"id": "n8", "x": 6, "y": 0}]
    comps = [{"id": "B", "type": "battery", "a": "n1", "b": "n2", "value": 12, "label": "12 V"},
             {"id": "R1", "type": "resistor", "a": "n2", "b": "n3", "value": 4, "label": "R₁ = 4 Ω"},
             {"id": "w1", "type": "wire", "a": "n3", "b": "n4", "value": None, "label": ""},
             {"id": "R2", "type": "resistor", "a": "n4", "b": "n5", "value": 6, "label": "R₂ = 6 Ω"},
             {"id": "w2", "type": "wire", "a": "n4", "b": "n7", "value": None, "label": ""},
             {"id": "R3", "type": "resistor", "a": "n7", "b": "n8", "value": 3, "label": "R₃ = 3 Ω"},
             {"id": "w3", "type": "wire", "a": "n8", "b": "n5", "value": None, "label": ""},
             {"id": "w4", "type": "wire", "a": "n5", "b": "n6", "value": None, "label": ""},
             {"id": "w5", "type": "wire", "a": "n6", "b": "n1", "value": None, "label": ""}]
    return {"nodes": nodes, "components": comps, "analysis": "dc", "show_currents": True,
            "checks": [{"label": "battery current", "quantity": "current", "component": "R1", "expect": 2, "tol_pct": 1},
                       {"label": "voltage across R₂", "quantity": "voltage", "component": "R2", "expect": 4, "tol_pct": 1}]}
