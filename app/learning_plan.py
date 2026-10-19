"""Ground a study request in the existing course and prerequisite graph."""
import json
import re

from . import curriculum, learner, model_choices, practice

FROM_SCRATCH = re.compile(r"from scratch|from (?:the )?(?:very )?(?:start|beginning|basics)|start over|start again|know nothing|zero knowledge", re.I)
START = re.compile(r"\b(?:let'?s|lets|let us)?\s*(?:get started|start learning|start studying)\b", re.I)
SCHEMA = {"type": "object", "additionalProperties": False,
          "properties": {"kind": {"type": "string", "enum": ["course", "skills", "question", "clarify"]},
                         "lesson": {"type": "string"}, "skills": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
                         "from_scratch": {"type": "boolean"}, "reply": {"type": "string"}},
          "required": ["kind", "lesson", "skills", "from_scratch", "reply"]}


def modules(lid):
    ls = curriculum.load()["lessons"][lid]
    if lid in ("ch8-9", "ch8"):
        ranges = [("Motion in a circle", 1, 2), ("Moment of inertia", 3, 7), ("Torque & spin energy", 8, 10),
                  ("Rolling", 11, 13), ("Pivots & collisions", 14, 17), ("Angular momentum in 3D", 18, 21),
                  ("Precession", 22, 25), ("Rolling in 3D & tops", 26, 30)]
        return [{"title": title, "problems": [r['n'] for r in ls['rungs'] if a <= r['n'] <= b]}
                for title, a, b in ranges if a <= len(ls['rungs'])]
    out = []
    for r in ls['rungs']:
        if not out or out[-1]['title'] != r['level'] or len(out[-1]['problems']) >= 5:
            out.append({"title": r['level'], "problems": []})
        out[-1]['problems'].append(r['n'])
    return out


def interpret(text, search, context=None):
    """Fast path for explicit course requests; selected tutor resolves unfamiliar phrasing."""
    context = context if context in curriculum.load()['lessons'] else None
    scratch = bool(FROM_SCRATCH.search(text))
    if not scratch and re.match(r"\s*(?:why|how|what|when|where|does|is|are)\b", text, re.I):
        return {"kind": "question"}
    explicit = bool(practice.PRACTICE.search(text) or START.search(text) or scratch)
    if not explicit and not practice.chapter_numbers(text):
        return {"kind": "question"}
    g = practice.parse(text, search)
    if g.get('error') and practice.chapter_numbers(text):
        return g  # Coverage of a named chapter is already known; do not ask a model to guess.
    residue = FROM_SCRATCH.sub(' ', practice.CLASS.sub(' ', practice.PRACTICE.sub(' ', START.sub(' ', text.lower()))))
    generic = practice.FILLER | set("let lets let's us this that these it from scratch start beginning zero knowledge build building understand up out do can could would you".split())
    has_topic = any(w not in generic for w in re.findall(r"[a-z0-9']+", residue))
    if not has_topic and not practice.chapter_numbers(text):
        # Only resolve references to an actual open/current course, never an invented topic.
        lid = context or practice.default_scope().get('lesson')
        g = {"kind": "practice", "scope": practice.lesson_scope(lid, text) if lid else practice.default_scope(text)}
    elif re.search(r"\brotation\b", text, re.I) and not practice.chapter_numbers(text):
        g = {"kind": "practice", "scope": practice.lesson_scope('ch8-9', text)}
    elif g.get('default') or g.get('error') or g['kind'] == 'question':
        cur = curriculum.load()
        catalog = {"courses": [{"id": k, "title": v['title']} for k, v in cur['lessons'].items()],
                   "skills": [{"id": k, "title": v['title']} for k, v in cur['skills'].items() if k in cur['examples']]}
        prompt = ("Interpret the student's physics learning request. Choose only exact course/skill IDs from the catalog. "
                  "Use course for chapters 8-9/rotation and skills for narrower topics. Select ONLY 1–3 final target skills, never prerequisites: the app adds their necessary prerequisites automatically. "
                  "The targets must include the actual requested topic, not just its foundations. A from-scratch chapter 9 request should include chapter 8: ch8-9. "
                  "For questions about one step use question, not a new plan. If the topic isn't covered or is ambiguous, use clarify and ask one short useful question. "
                  "Never map an unrelated topic to the current course. Do not invent available content. Return JSON only.\n" +
                  json.dumps({"catalog": catalog, "current_course": context, "request": text}))
        raw, meta = model_choices.run(model_choices.current('chat'), prompt, schema_text=json.dumps(SCHEMA), timeout=180)
        from .providers import extract_json
        out = extract_json(raw)
        scratch = scratch or out.get('from_scratch') is True
        if out.get('kind') == 'question':
            return {"kind": "question"}
        if out.get('kind') == 'course' and out.get('lesson') in cur['lessons']:
            g = {"kind": "practice", "scope": practice.lesson_scope(out['lesson'], text)}
        elif out.get('kind') == 'skills' and isinstance(out.get('skills'), list) and 1 <= len(out['skills']) <= 5 and all(isinstance(s,str) and s in cur['examples'] for s in out['skills']):
            ids = list(dict.fromkeys(out['skills']))
            g = {"kind": "practice", "scope": practice.scope_for(ids, cur['skills'][ids[0]]['title'], text=text)}
        else:
            return {"kind": "clarify", "reply": str(out.get('reply') or "Which physics topic would you like to start with?")[:600]}
        g['scope']['planner'] = {k: meta[k] for k in ('model','effort','tier','secs') if k in meta}
    if g.get('scope'):
        g['scope']['from_scratch'] = scratch
        if scratch and g['scope'].get('lesson') == 'ch9':
            g['scope'] = {**practice.lesson_scope('ch8-9', text), "from_scratch": True}
    return g


def prepare(conn, scope):
    """Save the concrete route and reason with the session, never grant knowledge for chat."""
    cur = curriculum.load()
    scratch = scope.get('from_scratch', False)
    if scope.get('lesson'):
        lid = scope['lesson']
        ls = cur['lessons'][lid]
        groups = modules(lid)
        start = 1 if scratch else practice.workspace_position(conn, lid) or (practice.lesson_progress(conn, lid).get('next') or {}).get('n') or 1
        scope['workspace_rung'] = start
        if scratch:
            scope['fresh_rungs'] = [r['n'] for r in ls['rungs']]
        plan = {"title": scope['title'], "from_scratch": scratch, "request": scope.get('text', ''),
                "approach": "Start with the foundations. Follow one worked example, then try a similar problem. Build one idea at a time." if scratch else "Pick up your saved place. Work an example together, then try one yourself.",
                "modules": groups, "start": start, "first": ls['rungs'][start-1]['title']}
    else:
        states = learner.states(conn)
        target = set(scope['targets'])
        needed = set(target)
        def visit(s):
            for p in cur['skills'][s]['prereqs']:
                if p['type'] == 'necessary' and p['id'] not in needed and (scratch or states[p['id']]['state'] not in ('confirmed','mastered')):
                    needed.add(p['id']); visit(p['id'])
        if scratch:
            for s in list(target): visit(s)
        ordered = [s for s in curriculum.route(list(needed)) if s in needed] if scratch else scope['order']
        if scratch:
            scope.update(targets=ordered, order=ordered, focus=[])
        plan = {"title": scope['title'], "from_scratch": scratch, "request": scope.get('text',''),
                "approach": "Refresh the prerequisites first, then build toward your topic with worked examples and a similar problem." if scratch else "Follow a worked example, then try one yourself. Refresh missing prerequisites as you go.",
                "modules": [{"title": cur['skills'][s]['title'], "skill": s, "problems": []} for s in ordered],
                "first": cur['skills'][ordered[0]]['title']}
    scope['learning_plan'] = plan
    return scope
