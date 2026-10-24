"""Kinema — a physics coach: a screenshot of a problem becomes a guided lesson with a model or a drawing.

Owner (2026-09-04): "instantly make a super clear visual diagram based on the problems I'm doing … walk me through
the problems with motion, pause and slow it down" — and then: "it has to work for literally any unique problem, not
these super optimized scenarios; the idea is visualization."
Owner (2026-09-22): Opus 5.5 becomes Kinema's tutor model; "it's meant to guide you through problems you take a
screenshot of and create models when realistic, if not give the best drawings, like circuits". 0.5.0 adds coached
steps, follow-up questions, answer checks, multi-part problems, 3D rigid bodies, circuits and spaced review.

Three solve modes:
* tutor (default): solve the physics problem across domains, with an appropriate graph, diagram, mechanics scene,
  3D rigid-body model, circuit, or an explicit explanation when a faithful visualization is unavailable (app/tutor.py).
* scene: the model writes a SCENE for the general rigid-body engine (app/scenes.py
  schema → static/js/engine2d.js, planck/Box2D → static/js/world3d_generic.js). Any planar problem.
* template (/classic = static/index.html): the model picks ONE closed-form template (app/registry.py). Kept as the
  oracle the general engine is tested against (static/oracle.html).

Model work runs as background jobs (app/jobs.py) the page polls: Panel's embedding proxy buffers whole responses,
and a closed tab must not lose a solve.
"""
from __future__ import annotations

import json
import math
import mimetypes
import os
import re
import sqlite3
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import chapter_map, library_problems, course_cards, curriculum, daily, daily_visuals, dictation, jobs, learn_api, learner, notes, providers, registry, reminder, scenes, session, study, study_guides, tasks, teacher, tutor, visual_library, workspace
from . import library_folders, screenshots_api, sim_lab

VERSION = "1.50.2"
# Windows registry associations can override WebP with text/plain. These are images.
mimetypes.add_type('image/webp', '.webp')
ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ["KINEMA_DATA"]) if os.environ.get("KINEMA_DATA") else ROOT / "data"
DATA.mkdir(parents=True, exist_ok=True)
(DATA / "uploads").mkdir(exist_ok=True)
DB_PATH = DATA / "kinema.db"
SETTINGS_PATH = DATA / "settings.json"
SCHEMA_PATH = DATA / "scene.schema.json"                 # template mode
SCENE_SCHEMA_PATH = DATA / "scene2.schema.json"          # general scene mode
TUTOR_SCHEMA_PATH = DATA / "tutor.schema.json"           # cross-domain physics tutor
SCHEMA_PATH.write_text(registry.schema_file_text(), encoding="utf-8")
SCENE_SCHEMA_PATH.write_text(scenes.schema_file_text(), encoding="utf-8")
TUTOR_SCHEMA_PATH.write_text(tutor.schema_file_text(), encoding="utf-8")

app = FastAPI(title="Kinema", version=VERSION)

# Role defaults live in model_choices: Haiku teaches from prepared references,
# Opus builds visuals. Later explicit selections persist independently per role.
from . import model_choices, localization, provider_connections, account

DEFAULT_SETTINGS = {**model_choices.DEFAULTS, "provider": "claude", "model": "gpt-5.6-sol", "effort": "high",
                    "ollama_model": "qwen3.8:27b", "claude_model": providers.DEFAULT_CLAUDE_MODEL, "settings_rev": "2",
                    "reminder_time": "", "ui_language": "en", "tutor_language": "auto", "account_provider": ""}
SOLVE_LOG = DATA / "solve.log"
ASK_EFFORT = "medium"
CHECK_EFFORT = "low"


def _log_solve(entry: dict) -> None:
    """One JSON line per solve attempt — the owner's 'it just doesn't work' needs a trail on disk."""
    try:
        entry = {"ts": time.strftime("%Y-%m-%d %H:%M:%S"), **entry}
        with SOLVE_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False)[:6000] + "\n")
    except OSError:
        pass

SYSTEM_PROMPT = """You are Kinema's problem reader for an intro classical-mechanics course (Morin, Introduction to
Classical Mechanics, chapter 8: angular momentum with a fixed L-hat direction — moments of inertia, torque,
rolling, collisions, angular impulse).

You do NOT write physics simulations. You read the problem, pick EXACTLY ONE template from the catalogue below,
fill its parameters from the givens (SI units; angles in degrees where the parameter says °; use the defaults
for anything the problem leaves open and say so in a step), and write a narrated walk-through the app will
play alongside the animation. Then return ONE JSON object matching the schema you were given — nothing else.

Rules:
- Pick the template whose physics IS the problem. If none fits, use "static_diagram" and supply a clean labelled
  SVG (viewBox 0 0 800 500, dark background friendly: light strokes, labelled vectors).
- params: a list of {"name", "value"} pairs using only the template's parameter names; values are plain
  numbers in SI (no unit strings) or the enum word. Leave out what you did not set.
- svg: an empty string unless the template is static_diagram. notes: anything worth telling the student.
- steps: 4–10 short steps in teaching order — setup and what to conserve/which torque, the free-body diagram,
  the key equation(s), solving, the answer with a sanity check. Each body is markdown with LaTeX ($..$ inline,
  $$..$$ display). "show" picks overlays: diagram, fbd, components, vectors, energy, graphs, trail, labels.
  "at" is the time in seconds into the motion where that step should pause (null for static steps).
  "highlight" names quantities to glow (e.g. "friction", "N", "L", "omega", "v", "torque").
- answer: the single number the problem actually asks for, with its key from the template's answer keys (or
  "other" when the asked quantity is not among them), the units, and the symbolic expression in LaTeX. The app
  compares your number with its own simulation and shows whether they agree — so compute it carefully.
- If the problem gives symbols only (m, R, θ) and no numbers, choose sensible defaults, state them in the
  restatement, and give the answer both symbolically (expression) and numerically for those defaults.

Template catalogue:
"""


def _settings() -> dict:
    try:
        d = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        d = {}
    out = {**DEFAULT_SETTINGS, **{k: v for k, v in d.items() if k in DEFAULT_SETTINGS}}
    if str(d.get("settings_rev") or "") != "2":
        # settings written by 0.4 (Fable-only era): move to the 0.5 default once; later explicit choices stick
        if out.get("claude_model") in ("fable", "", None):
            out["claude_model"] = providers.DEFAULT_CLAUDE_MODEL
        out["provider"] = "claude"
        out["settings_rev"] = "2"
    return out


def _save_settings(d: dict) -> dict:
    localization.validate_patch(d)
    model_choices.validate_patch(d)
    cur = _settings()
    for k in DEFAULT_SETTINGS:
        if k in d and isinstance(d[k], str):
            cur[k] = d[k][:240 if k in {r + '_model' for r in model_choices.ROLES} else 80]
    for role in model_choices.ROLES:
        if any(role + '_' + key in d for key in ('model', 'effort', 'speed')):
            model_choices.validate_selection(cur, role)
        selected = model_choices.profile(cur, role)
        if any(role + '_' + key in d for key in ('model', 'effort', 'speed')) and selected['model'].startswith('claude:') and selected['speed'] != 'standard':
            raise ValueError('Choose Standard speed for Claude models.')
    cur["settings_rev"] = "2"
    SETTINGS_PATH.write_text(json.dumps(cur), encoding="utf-8")
    return cur


_DB_READY: dict = {}


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    if _DB_READY.get("path") != str(DB_PATH):
        # once per process (and per data folder in tests): tables, WAL for the background note writers, shipped notes
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""CREATE TABLE IF NOT EXISTS problems(
            id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT, text TEXT, image TEXT,
            scene TEXT NOT NULL, warnings TEXT, meta TEXT, created_ts REAL NOT NULL, updated_ts REAL NOT NULL)""")
        study.ensure_tables(conn)
        learner.ensure_tables(conn)
        notes.ensure_tables(conn)
        tasks.ensure_tables(conn)
        session.ensure_tables(conn)
        workspace.ensure_tables(conn)
        teacher.ensure_tables(conn)
        study_guides.ensure_tables(conn)
        course_cards.ensure_tables(conn)
        daily.ensure_tables(conn)
        library_problems.ensure_tables(conn)
        library_folders.ensure_tables(conn)
        study.seed(conn)
        notes.import_pack(conn)
        conn.commit()
        _DB_READY["path"] = str(DB_PATH)
    return conn


def _note_task(payload: dict, progress) -> dict:
    return notes.generate(DB_PATH, payload["skill"], progress, work_dir=DATA / "pages")


@app.on_event("startup")
def _start_background() -> None:
    db().close()
    tasks.register("note", _note_task)
    if os.environ.get("KINEMA_TASKS", "on") != "off":
        tasks.start(DB_PATH, workers=2)


def build_prompt(problem_text: str, has_image: bool) -> str:
    head = SYSTEM_PROMPT + registry.prompt_catalog()
    body = "\n\nPROBLEM:\n" + (problem_text.strip() or "(see the attached photo of the problem)")
    if has_image:
        body += "\n\n(A photo of the problem is attached; read it carefully, it is the source of truth.)"
    body += "\n\nReturn the JSON object now."
    return head + body


def validate_any(scene: dict) -> tuple[dict, list[str]]:
    """Saved tutor lessons, general scenes and classic templates keep their formats."""
    if isinstance(scene, dict) and scene.get("kind") == "tutor":
        return tutor.validate(scene)
    if isinstance(scene, dict) and "bodies" in scene:
        return scenes.validate_spec(scene)
    return registry.validate(scene)


def solve(problem_text: str, image_path: str | None, settings: dict, mode: str = "tutor", *,
          on_event=None, cancel=None, earlier: list[dict] | None = None, extra_images: list[str] | None = None) -> dict:
    if mode not in ("tutor", "scene", "template"):
        raise ValueError("mode must be tutor, scene or template")
    module = tutor if mode == "tutor" else scenes if mode == "scene" else registry
    system = None
    if mode == "tutor":
        system, prompt = tutor.build_messages(problem_text, bool(image_path or extra_images), earlier)
    elif mode == "scene":
        prompt = module.build_prompt(problem_text, bool(image_path))
    else:
        prompt = build_prompt(problem_text, bool(image_path))
    schema_path = {"tutor": TUTOR_SCHEMA_PATH, "scene": SCENE_SCHEMA_PATH, "template": SCHEMA_PATH}[mode]
    schema_text = module.schema_file_text()
    images = ([image_path] if image_path else []) + list(extra_images or [])
    text, meta = model_choices.run(model_choices.profile(settings, "build"), prompt, images=images,
                                  schema_text=schema_text, system=system, timeout=900, on_event=on_event, cancel=cancel)
    raw = providers.extract_json(text)
    try:
        scene, warnings = scenes.validate_spec(raw) if mode == "scene" else tutor.validate_generated(raw) if mode == "tutor" else module.validate(raw)
    except tutor.TutorValidationError as exc:
        # Keep the provider's final answer available to the requesting client for
        # diagnosis; never attach CLI logs, settings, credentials or environment.
        exc.model_response = text[:40000]
        raise
    return {"scene": scene, "warnings": warnings, "meta": meta, "raw": text[:40000], "mode": mode}


@app.middleware("http")
async def _no_store(request: Request, call_next):
    resp = await call_next(request)
    if request.url.path in ("/", "/index.html", "/lab", "/lab.html", "/app.html", "/manifest.webmanifest", "/classic", "/sim.html", "/studio.html", "/oracle.html"):
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
    elif request.url.path.startswith("/js/") or request.url.path.endswith(".css"):
        resp.headers["Cache-Control"] = "no-cache"      # a template fix must reach the open page on reload (live 2026-09-04)
    elif request.url.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "app.html", media_type="text/html")


@app.get("/manifest.webmanifest")
def web_manifest():
    return FileResponse(ROOT / "static" / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/lab")
def lab():
    return FileResponse(ROOT / "static" / "lab.html", media_type="text/html")


@app.get("/classic")
def classic():
    return FileResponse(ROOT / "static" / "index.html", media_type="text/html")


@app.get("/api/health")
def health() -> dict:
    s = _settings()
    chat, build = model_choices.profile(s, "chat"), model_choices.profile(s, "build")
    return {"ok": True, "version": VERSION, "ts": time.time(),
            "model": build["label"], "effort": build["effort"],
            "quick": chat["label"] + (" (Fast)" if chat["speed"] == "fast" else ""), "curriculum": curriculum.load()["version"]}


@app.get("/api/templates")
def templates() -> dict:
    return registry.registry_json()


@app.get("/api/examples")
def examples() -> dict:
    try:
        return json.loads(scenes.EXAMPLES_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


@app.post("/api/validate")
async def api_validate(request: Request) -> dict:
    """Repair a hand-edited scene (the Lab's what-if editor) exactly the way a model's scene is repaired."""
    body = await request.json()
    try:
        scene, warnings = validate_any(body.get("scene") if isinstance(body, dict) and "scene" in body else body)
    except tutor.TutorValidationError as exc:
        return JSONResponse({"error": str(exc)}, status_code=422)
    return {"scene": scene, "warnings": warnings}


@app.get("/api/tutor/examples")
def tutor_examples() -> dict:
    # served validated, exactly as a solved lesson would be (circuits carry the app's own solution)
    return {k: {**v, "spec": tutor.validate(v["spec"])[0]} for k, v in tutor.examples().items()}


@app.get("/api/settings")
def settings_get() -> dict:
    s = _settings()
    s["codex_models"] = providers.CODEX_MODELS
    s["claude_models"] = [{"id": m, "label": providers.CLAUDE_LABELS.get(m, m)} for m in providers.CLAUDE_MODELS[:3]]
    s["claude_efforts"] = providers.CLAUDE_EFFORTS
    s["ollama_models"] = providers.ollama_models()
    s["efforts"] = providers.CODEX_EFFORTS
    return s


@app.post("/api/settings")
async def settings_set(request: Request) -> dict:
    try:
        body = await request.json()
        if isinstance(body, dict) and "account_provider" in body:
            raise ValueError("Choose the account in Settings › Account.")
        saved = _save_settings(body)
        account.remember(body if isinstance(body, dict) else {})
        return saved
    except (ValueError, TypeError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/api/models")
def models_get():
    s = _settings()
    return {"models": model_choices.signed_in_catalog(), "account": account.active_provider(),
            "roles": {r: model_choices.profile(s, r) for r in model_choices.ROLES}}

@app.get("/api/languages")
def languages_get():
    s = _settings()
    return {"languages": localization.languages(), "ui_language": s['ui_language'], "tutor_language": s['tutor_language']}


# ── solving ───────────────────────────────────────────────────────────────────────────────────────────────────
async def _read_solve_request(request: Request) -> tuple[dict | None, JSONResponse | None]:
    """Shared by the blocking /api/solve and the job endpoint: text, optional image, mode, overrides, parent."""
    ctype = request.headers.get("content-type") or ""
    text, image_path, mode, parent_id = "", None, "tutor", None
    overrides: dict = {}
    if ctype.startswith("multipart/"):
        async with request.form() as form:     # closes the uploaded file
            text = str(form.get("text") or "")
            mode = str(form.get("mode") or "tutor")
            parent_id = str(form.get("parent_id") or "") or None
            for k in ("provider", "model", "effort", "ollama_model", "claude_model"):
                if form.get(k):
                    overrides[k] = str(form.get(k))
            up = form.get("image")
            # duck-typed on purpose: request.form() yields STARLETTE's UploadFile, which is not an instance of FastAPI's
            # subclass — an isinstance check silently dropped every photo (owner report 2026-09-04: "uploaded the pic,
            # then couldn't do anything"; the server answered 400 "give me the problem")
            if up is not None and hasattr(up, "filename") and hasattr(up, "read") and up.filename:
                raw = await up.read()
                if len(raw) > 25_000_000:
                    return None, JSONResponse({"error": "image over 25 MB"}, status_code=413)
                ext = Path(up.filename).suffix.lower() or ".png"
                if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"):
                    ext = ".png"
                p = DATA / "uploads" / f"{uuid.uuid4().hex[:12]}{ext}"
                p.write_bytes(raw)
                image_path = str(p)
    else:
        body = await request.json()
        text = str(body.get("text") or "")
        mode = str(body.get("mode") or "tutor")
        parent_id = str(body.get("parent_id") or "") or None
        overrides = {k: str(body[k]) for k in ("provider", "model", "effort", "ollama_model", "claude_model") if body.get(k)}
    if not text.strip() and not image_path:
        return None, JSONResponse({"error": "give me the problem — text, a photo, or both"}, status_code=400)
    if mode not in ("tutor", "scene", "template"):
        return None, JSONResponse({"error": "mode must be tutor, scene or template"}, status_code=400)
    if overrides:
        overrides.update(build_model="", build_effort="")
    return {"text": text, "image_path": image_path, "mode": mode, "parent_id": parent_id,
            "settings": {**_settings(), **overrides}}, None


def _upload_path(url: str | None) -> Path | None:
    if not url or not isinstance(url, str) or not re.fullmatch(r"/uploads/[A-Za-z0-9_.-]+", url):
        return None
    p = DATA / "uploads" / url.rsplit("/", 1)[1]
    return p if p.is_file() else None


def _problem_row(conn, pid: str) -> dict | None:
    r = conn.execute("SELECT * FROM problems WHERE id=?", (pid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["scene"] = json.loads(d["scene"])
    from .lesson_views import presentation
    d["presentation"] = presentation(d["scene"])
    d["warnings"] = json.loads(d["warnings"] or "[]")
    d["meta"] = json.loads(d["meta"] or "{}")
    return d


def _thread_context(parent_id: str | None) -> tuple[list[dict], dict]:
    """Earlier parts (oldest first) and the thread fields to store with a new part."""
    if not parent_id:
        return [], {}
    conn = db()
    try:
        chain, pid = [], parent_id
        while pid and len(chain) < 8:
            row = _problem_row(conn, pid)
            if not row:
                break
            chain.append(row)
            pid = (row["meta"] or {}).get("parent_id")
    finally:
        conn.close()
    if not chain:
        return [], {}
    chain.reverse()
    earlier = [{"restatement": r["scene"].get("restatement", ""), "answers": r["scene"].get("answers") or [],
                "image": r.get("image")} for r in chain if r["scene"].get("kind") == "tutor"]
    root = chain[0]
    root_id = (root["meta"] or {}).get("root_id") or root["id"]
    return earlier, {"parent_id": parent_id, "root_id": root_id, "part": len(chain) + 1}


def _save_solved(out: dict, text: str, image_url: str | None, thread: dict) -> tuple[str | None, list[str], str | None]:
    """Every successful solve is kept (a closed tab never loses the model's work) and feeds the review deck."""
    try:
        pid = uuid.uuid4().hex[:10]
        now = time.time()
        conn = db()
        meta = {**(out.get("meta") or {}), **thread}
        conn.execute("INSERT INTO problems(id,title,source,text,image,scene,warnings,meta,created_ts,updated_ts) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (pid, str((out.get("scene") or {}).get("title") or "Untitled")[:160], "auto", text[:20000], image_url or "",
                      json.dumps(out["scene"]), json.dumps(out.get("warnings") or []), json.dumps(meta), now, now))
        cards = study.add_lesson_cards(conn, out["scene"], pid) if (out.get("scene") or {}).get("kind") == "tutor" else []
        conn.commit()
        conn.close()
        return pid, cards, None
    except Exception as exc:  # noqa: BLE001
        return None, [], str(exc)[:200]


@app.post("/api/solve")
async def api_solve(request: Request):
    """Blocking solve (API callers, tests, the classic pages): multipart (text, image?, mode?) or JSON {text, mode}."""
    import asyncio
    req, error = await _read_solve_request(request)
    if error:
        return error
    text, image_path, mode, settings = req["text"], req["image_path"], req["mode"], req["settings"]
    earlier, thread = _thread_context(req["parent_id"])
    t0 = time.time()
    try:
        out = await asyncio.to_thread(solve, text, image_path, settings, mode, earlier=earlier or None)
    except providers.ProviderError as exc:
        _log_solve({"ok": False, "mode": mode, "provider": settings.get("provider"), "text": text[:300], "image": image_path, "secs": round(time.time() - t0, 1), "error": str(exc)})
        return JSONResponse({"error": str(exc)}, status_code=502)
    except tutor.TutorValidationError as exc:
        _log_solve({"ok": False, "mode": mode, "provider": settings.get("provider"), "secs": round(time.time() - t0, 1), "error": str(exc)})
        return JSONResponse({"error": "The model returned a lesson that cannot be displayed faithfully: " + str(exc),
                             "raw": getattr(exc, "model_response", None)}, status_code=502)
    except Exception as exc:  # noqa: BLE001 — a crash must become a visible error, not a silent 500
        _log_solve({"ok": False, "mode": mode, "provider": settings.get("provider"), "text": text[:300], "image": image_path, "secs": round(time.time() - t0, 1), "error": f"{type(exc).__name__}: {exc}"})
        return JSONResponse({"error": f"Kinema crashed while reading the model's answer: {type(exc).__name__}: {exc}"}, status_code=500)
    out["image"] = f"/uploads/{Path(image_path).name}" if image_path else None
    out["text"] = text
    out["saved_id"], out["cards_added"], save_error = _save_solved(out, text, out["image"], thread)
    if save_error:
        out["save_error"] = save_error
    _log_solve({"ok": True, "mode": mode, "meta": out.get("meta"), "text": text[:300], "image": image_path, "warnings": out.get("warnings"),
                "title": (out.get("scene") or {}).get("title"), "bodies": [b.get("id") for b in (out.get("scene") or {}).get("bodies", [])],
                "checks": len((out.get("scene") or {}).get("checks", [])), "saved_id": out.get("saved_id"), "raw_head": (out.get("raw") or "")[:300]})
    return out


@app.post("/api/jobs/solve")
async def api_solve_job(request: Request):
    """Start a tutor solve in the background; poll GET /api/jobs/{id} for the streaming lesson and the result."""
    req, error = await _read_solve_request(request)
    if error:
        return error
    text, image_path, settings, parent_id = req["text"], req["image_path"], req["settings"], req["parent_id"]
    earlier, thread = _thread_context(parent_id)
    extra_images = []
    if not image_path and earlier:
        # a text-only follow-up part: show the model the problem's original screenshot
        root_image = _upload_path(next((e.get("image") for e in earlier if e.get("image")), None))
        if root_image:
            extra_images.append(str(root_image))
    image_url = f"/uploads/{Path(image_path).name}" if image_path else None

    def run(job: jobs.Job) -> dict:
        t0 = time.time()
        try:
            out = solve(text, image_path, settings, "tutor", on_event=job.on_event, cancel=job.cancel,
                        earlier=earlier or None, extra_images=extra_images or None)
        except providers.ProviderError as exc:
            _log_solve({"ok": False, "mode": "tutor", "provider": settings.get("provider"), "text": text[:300], "image": image_path, "secs": round(time.time() - t0, 1), "error": str(exc)})
            raise jobs.JobError(str(exc)) from exc
        except tutor.TutorValidationError as exc:
            _log_solve({"ok": False, "mode": "tutor", "provider": settings.get("provider"), "secs": round(time.time() - t0, 1), "error": str(exc)})
            raise jobs.JobError("The model returned a lesson that cannot be displayed faithfully: " + str(exc),
                                raw=getattr(exc, "model_response", None)) from exc
        job.phase = "saving"
        out["image"] = image_url
        out["text"] = text
        out["saved_id"], out["cards_added"], save_error = _save_solved(out, text, image_url, thread)
        if save_error:
            out["save_error"] = save_error
        out["thread"] = thread
        _log_solve({"ok": True, "mode": "tutor", "meta": out.get("meta"), "text": text[:300], "image": image_path, "warnings": out.get("warnings"),
                    "title": (out.get("scene") or {}).get("title"), "visual": ((out.get("scene") or {}).get("visualization") or {}).get("kind"),
                    "saved_id": out.get("saved_id"), "parent_id": parent_id, "raw_head": (out.get("raw") or "")[:300]})
        out.pop("raw", None)
        return out

    job = jobs.start("solve", run, info={"image": image_url, "text": text[:300], "parent_id": parent_id,
                                         "model": providers.CLAUDE_LABELS.get(settings.get("claude_model"), settings.get("claude_model")),
                                         "effort": settings.get("effort")})
    return {"job_id": job.id, "image": image_url}


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "no such job (the server may have restarted)"}, status_code=404)
    return job.snapshot()


@app.post("/api/jobs/{job_id}/cancel")
def api_job_cancel(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "no such job"}, status_code=404)
    job.cancel.set()
    return {"ok": True}


@app.get("/api/jobs")
def api_jobs_running() -> list:
    return [j.snapshot() for j in jobs.running()]


# ── follow-up questions and answer checks ─────────────────────────────────────────────────────────────────────
ASK_SYSTEM = r"""You are Kinema, a physics coach, answering a student's follow-up question about ONE problem they are
working through. You are given the problem, the worked lesson (plan, steps, answers), how far the student has
revealed the steps, and the conversation so far. Answer the question directly and correctly, like a patient
teaching assistant at a whiteboard:
- Be concise: usually 2-8 sentences or a short list; longer only if the student asks for a full explanation.
- Use Markdown with $...$ (inline) and $$...$$ (display) KaTeX-compatible LaTeX.
- Refer to steps by number and to the visual when it helps ("in the model, the violet arrow is w").
- Coach first: when the student is still working (not all steps revealed) and asks what to do, give the idea or a
  hint for the NEXT step rather than the final answer, unless they explicitly ask for the answer.
- If the lesson contains a mistake, say so plainly and give the correction.
- If the question is unrelated to physics or the problem, answer briefly and steer back.
Write only the answer; no preamble."""

CHECK_SYSTEM = r"""You are Kinema, a physics coach, grading one attempt by a student at one step or answer of a problem.
You are given the problem, the reference result for that step/answer and the student's attempt (often informal:
"w = Omega(z+e3)", "about 48 rad/s", "the contact point doesn't move"). Decide whether the attempt is physically
and mathematically equivalent to the reference (allow equivalent forms, notation, rounding to 2-3 significant
figures, and correct results reached a different way). verdict: correct, partly (right idea but an error or
missing piece), incorrect, or unclear (cannot be interpreted). feedback: 1-3 sentences with $...$ LaTeX. When not
correct, point to the specific issue (a sign, a factor, a missing term, units) WITHOUT revealing the reference
result; the student will try again. When correct, confirm briefly and add one short insight about this step only:
never state the results of later steps (the student works through them next)."""
CHECK_SCHEMA = json.dumps({"type": "object", "additionalProperties": False, "required": ["verdict", "feedback"],
                           "properties": {"verdict": {"type": "string", "enum": ["correct", "partly", "incorrect", "unclear"]},
                                          "feedback": {"type": "string"}}})


def _lesson_digest(lesson: dict, revealed: int | None = None) -> str:
    """The lesson as compact text for follow-up calls (no visual payloads)."""
    lines = [f"TITLE: {lesson.get('title', '')}", f"PROBLEM: {lesson.get('restatement', '')}"]
    for key in ("givens", "assumptions"):
        if lesson.get(key):
            lines.append(key.upper() + ": " + "; ".join(lesson[key]))
    if lesson.get("plan"):
        lines.append("PLAN: " + lesson["plan"])
    for i, s in enumerate(lesson.get("steps") or [], 1):
        lines.append(f"STEP {i}: {s.get('title', '')}\n  question: {s.get('prompt', '')}\n  explanation: {s.get('body', '')}\n  result: {s.get('result', '')}")
    for a in lesson.get("answers") or []:
        val = f" = {a['value']} {a.get('units', '')}" if a.get("value") is not None else ""
        lines.append(f"ANSWER {a.get('label', '')}: {a.get('expression', '')}{val} ({a.get('note', '')})")
    v = lesson.get("visualization") or {}
    lines.append(f"VISUAL: {v.get('kind', 'none')}: {v.get('caption', '')}")
    if revealed is not None:
        n = len(lesson.get("steps") or [])
        lines.append(f"STUDENT PROGRESS: revealed {max(0, min(revealed, n))} of {n} steps.")
    return "\n".join(lines)


def _numbers_in(text: str) -> list[float]:
    out = []
    for m in re.finditer(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text.replace(",", "")):
        try:
            out.append(float(m.group()))
        except ValueError:
            pass
    return out


@app.post("/api/problems/{pid}/ask")
async def api_ask(pid: str, request: Request):
    body = await request.json()
    question = str(body.get("question") or "").strip()[:4000]
    if not question:
        return JSONResponse({"error": "ask a question"}, status_code=400)
    revealed = body.get("revealed")
    revealed = int(revealed) if isinstance(revealed, (int, float)) and not isinstance(revealed, bool) else None
    conn = db()
    row = _problem_row(conn, pid)
    if not row:
        conn.close()
        return JSONResponse({"error": "no such problem"}, status_code=404)
    history = study.messages(conn, pid)[-12:]
    study.add_message(conn, pid, "user", question, {"revealed": revealed})
    conn.commit()
    conn.close()
    lesson = row["scene"]
    image = _upload_path(row.get("image"))
    settings = _settings()
    convo = "\n".join(f"{'STUDENT' if m['role'] == 'user' else 'KINEMA'}: {m['content']}" for m in history)
    prompt = (_lesson_digest(lesson, revealed) + ("\n\nCONVERSATION SO FAR:\n" + convo if convo else "")
              + "\n\nSTUDENT'S QUESTION:\n" + question)
    from .lesson_views import diagram_context
    diagram = diagram_context(lesson, body.get('teaching_visual'))
    if diagram:
        prompt += '\n\nCURRENT EXPLANATORY DIAGRAM (validated snapshot, illustrative values):\n' + json.dumps(diagram, ensure_ascii=False)

    def run(job: jobs.Job) -> dict:
        try:
            text, meta = model_choices.run(model_choices.profile(settings, "chat"), prompt,
                                              images=[str(image)] if image else [], timeout=300, system=ASK_SYSTEM,
                                              on_event=job.on_event, cancel=job.cancel)
        except providers.ProviderError as exc:
            raise jobs.JobError(str(exc)) from exc
        c = db()
        reading = model_choices.context_usage(model_choices.profile(settings, "chat"), meta)
        study.add_message(c, pid, "assistant", text, {"model": meta.get("model"), "secs": meta.get("secs"), "context_usage": reading})
        c.commit()
        c.close()
        return {"answer": text, "meta": meta, "context_usage": reading}

    job = jobs.start("ask", run, info={"problem_id": pid})
    return {"job_id": job.id}


@app.get("/api/problems/{pid}/messages")
def api_messages(pid: str) -> list:
    conn = db()
    out = study.messages(conn, pid)
    conn.close()
    return out


@app.post("/api/problems/{pid}/check")
async def api_check(pid: str, request: Request):
    body = await request.json()
    target = str(body.get("target") or "")
    index = body.get("index")
    attempt = str(body.get("attempt") or "").strip()[:2000]
    if target not in ("step", "answer") or not isinstance(index, int) or isinstance(index, bool) or not attempt:
        return JSONResponse({"error": "target (step or answer), index and attempt are required"}, status_code=400)
    conn = db()
    row = _problem_row(conn, pid)
    conn.close()
    if not row or row["scene"].get("kind") != "tutor":
        return JSONResponse({"error": "no such lesson"}, status_code=404)
    lesson = row["scene"]
    items = lesson.get("steps" if target == "step" else "answers") or []
    if not 0 <= index < len(items):
        return JSONResponse({"error": "no such step or answer"}, status_code=400)
    item = items[index]
    if target == "answer" and item.get("value") is not None:
        ref = float(item["value"])
        nums = _numbers_in(attempt)
        if len(nums) == 1 and math.isfinite(ref) and abs(nums[0] - ref) <= max(0.02 * abs(ref), 1e-9):
            return {"result": {"verdict": "correct", "source": "numeric",
                               "feedback": f"Matches the worked value ({item['value']:g} {item.get('units', '')}).".replace(" )", ")")}}
    if target == "step":
        reference = f"STEP {index + 1}: {item.get('title', '')}\nQuestion asked: {item.get('prompt', '')}\nReference result: {item.get('result', '')}\nReference explanation: {item.get('body', '')}"
    else:
        val = f" = {item['value']} {item.get('units', '')}" if item.get("value") is not None else ""
        reference = f"ANSWER {item.get('label', '')}\nReference: {item.get('expression', '')}{val}\nNote: {item.get('note', '')}"
    prompt = (f"PROBLEM: {lesson.get('restatement', '')}\nGIVENS: {'; '.join(lesson.get('givens') or [])}\n\n{reference}\n\n"
              f"STUDENT'S ATTEMPT:\n{attempt}")
    settings = _settings()

    def run(job: jobs.Job) -> dict:
        try:
            text, meta = model_choices.run(model_choices.profile(settings, "chat"), prompt,
                                              schema_text=CHECK_SCHEMA, timeout=180, system=CHECK_SYSTEM,
                                              on_event=job.on_event, cancel=job.cancel)
            out = providers.extract_json(text)
        except providers.ProviderError as exc:
            raise jobs.JobError(str(exc)) from exc
        verdict = out.get("verdict") if out.get("verdict") in ("correct", "partly", "incorrect", "unclear") else "unclear"
        return {"verdict": verdict, "feedback": str(out.get("feedback") or "")[:2000], "source": "model", "meta": meta}

    job = jobs.start("check", run, info={"problem_id": pid, "target": target, "index": index})
    return {"job_id": job.id}


# ── review (spaced repetition) ────────────────────────────────────────────────────────────────────────────────
@app.get("/api/review/summary")
def api_review_summary() -> dict:
    conn = db()
    out = study.summary(conn)
    conn.close()
    return out


@app.get("/api/review/queue")
def api_review_queue(limit: int = 30) -> list:
    conn = db()
    out = study.queue(conn, limit=max(1, min(int(limit), 200)))
    conn.close()
    return out


@app.post("/api/review/{card_id}")
async def api_review_grade(card_id: str, request: Request):
    body = await request.json()
    grade = str(body.get("grade") or "")
    conn = db()
    try:
        out = study.review(conn, card_id, grade)
        conn.commit()
    except KeyError:
        return JSONResponse({"error": "no such card"}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    finally:
        conn.close()
    return out


@app.get("/api/cards")
def api_cards(problem_id: str | None = None) -> list:
    conn = db()
    if problem_id:
        rows = conn.execute("SELECT * FROM cards WHERE problem_id=? ORDER BY created_ts", (problem_id,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM cards ORDER BY created_ts DESC LIMIT 1000").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/cards")
async def api_card_add(request: Request):
    body = await request.json()
    conn = db()
    cid = study.add_card(conn, str(body.get("front") or ""), str(body.get("back") or ""), topic=str(body.get("topic") or "")[:80],
                         source="manual", problem_id=str(body.get("problem_id") or "") or None)
    conn.commit()
    conn.close()
    if not cid:
        return JSONResponse({"error": "a card needs a front and a back, and must not duplicate an existing card"}, status_code=400)
    return {"ok": True, "id": cid}


@app.post("/api/cards/{card_id}/suspend")
async def api_card_suspend(card_id: str, request: Request):
    body = await request.json()
    conn = db()
    n = conn.execute("UPDATE cards SET suspended=? WHERE id=?", (1 if body.get("suspended", True) else 0, card_id)).rowcount
    conn.commit()
    conn.close()
    return {"ok": bool(n)}


@app.delete("/api/cards/{card_id}")
def api_card_delete(card_id: str) -> dict:
    conn = db()
    n = conn.execute("DELETE FROM cards WHERE id=?", (card_id,)).rowcount
    conn.commit()
    conn.close()
    return {"ok": True, "deleted": n}


# ── saved problems ────────────────────────────────────────────────────────────────────────────────────────────
@app.get("/uploads/{name}")
def upload_file(name: str):
    safe = "".join(c for c in name if c.isalnum() or c in "._-")
    p = DATA / "uploads" / safe
    if not p.exists():
        return JSONResponse({"error": "no such file"}, status_code=404)
    return FileResponse(p)


@app.get("/api/library/problems")
def library_problems_list() -> dict:
    """Problems found in chats (curated, de-duplicated) plus problems saved earlier, each once."""
    try:
        library_problems.sync()
    except Exception:  # noqa: BLE001 - a sync problem must never hide what is already filed
        pass
    items = [{**r, "kind": "chat"} for r in library_problems.listing()]
    seen_titles = set()
    for r in problems_list():
        title = " ".join((r.get("title") or "").lower().split())
        if title in seen_titles or r.get("root_id") and r.get("root_id") != r["id"]:
            continue
        seen_titles.add(title)
        items.append({"id": r["id"], "kind": "saved", "statement": r["title"], "number": None, "verified": False, "crop": r.get("image") or "",
                      "thread_id": None, "times": 1, "created_ts": r["created_ts"], "domain": r.get("domain")})
    return {"items": items}


@app.get("/api/library/problems/other")
def library_problems_other() -> dict:
    """Chat uploads that are not filed (not kept, not worked on): hidden from the list, never deleted."""
    try:
        library_problems.sync()
    except Exception:  # noqa: BLE001
        pass
    return {"items": [{**r, "kind": "chat"} for r in library_problems.listing(candidates=True)]}


@app.post("/api/library/problems/{lid}/keep")
def library_problem_keep(lid: str, on: bool = True) -> dict:
    return {"ok": True, "kept": library_problems.keep(lid, on)}


@app.delete("/api/library/problems/{lid}")
def library_problem_hide(lid: str) -> dict:
    return {"ok": True, "hidden": library_problems.hide(lid)}


@app.get("/api/problems")
def problems_list() -> list:
    conn = db()
    rows = conn.execute("SELECT id, title, source, image, created_ts, updated_ts, "
                        "json_extract(scene,'$.template') AS template, json_extract(scene,'$.focus') AS focus, "
                        "json_extract(scene,'$.kind') AS kind, json_extract(scene,'$.domain') AS domain, "
                        "json_extract(scene,'$.visualization.kind') AS visual, json_extract(scene,'$.status') AS status, "
                        "json_extract(meta,'$.parent_id') AS parent_id, json_extract(meta,'$.root_id') AS root_id, "
                        "json_extract(meta,'$.part') AS part "
                        "FROM problems ORDER BY updated_ts DESC LIMIT 500").fetchall()
    counts = {r[0]: r[1] for r in conn.execute("SELECT problem_id, COUNT(*) FROM messages GROUP BY problem_id")}
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d["mode"] = "tutor" if d.get("kind") == "tutor" else "template" if d.get("template") else "scene"
        d["messages"] = counts.get(d["id"], 0)
        out.append(d)
    return out


@app.post("/api/problems")
async def problems_save(request: Request) -> dict:
    body = await request.json()
    try:
        scene, warnings = validate_any(body.get("scene") or {})
    except tutor.TutorValidationError as exc:
        return JSONResponse({"error": str(exc)}, status_code=422)
    pid = str(body.get("id") or uuid.uuid4().hex[:10])
    now = time.time()
    conn = db()
    conn.execute("INSERT INTO problems(id,title,source,text,image,scene,warnings,meta,created_ts,updated_ts) "
                 "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, "
                 "source=excluded.source, text=excluded.text, image=excluded.image, scene=excluded.scene, "
                 "warnings=excluded.warnings, meta=excluded.meta, updated_ts=excluded.updated_ts",
                 (pid, str(body.get("title") or scene["title"])[:160], str(body.get("source") or "")[:120],
                  str(body.get("text") or "")[:20000], str(body.get("image") or "")[:300],
                  json.dumps(scene), json.dumps(warnings), json.dumps(body.get("meta") or {}), now, now))
    conn.commit()
    conn.close()
    return {"ok": True, "id": pid}


@app.get("/api/problems/{pid}")
def problems_get(pid: str):
    conn = db()
    d = _problem_row(conn, pid)
    if not d:
        conn.close()
        return JSONResponse({"error": "no such problem"}, status_code=404)
    d["mode"] = "tutor" if d["scene"].get("kind") == "tutor" else "scene" if "bodies" in d["scene"] else "template"
    if d["mode"] == "tutor":
        try:
            # 0.4 lessons gain the 0.5 fields; derived circuit solutions are recomputed
            d["scene"], _ = tutor.validate(d["scene"])
        except tutor.TutorValidationError:
            pass
    root_id = (d["meta"] or {}).get("root_id") or pid
    parts = conn.execute("SELECT id, title, created_ts, json_extract(meta,'$.part') AS part FROM problems "
                         "WHERE id=? OR json_extract(meta,'$.root_id')=? ORDER BY created_ts", (root_id, root_id)).fetchall()
    d["thread"] = [dict(p) for p in parts] if len(parts) > 1 else []
    d["messages"] = study.messages(conn, pid)
    d["cards"] = [dict(r) for r in conn.execute("SELECT id, front, back, suspended FROM cards WHERE problem_id=? ORDER BY created_ts", (pid,))]
    conn.close()
    return d


@app.delete("/api/problems/{pid}")
def problems_delete(pid: str) -> dict:
    conn = db()
    n = conn.execute("DELETE FROM problems WHERE id=?", (pid,)).rowcount
    conn.execute("DELETE FROM messages WHERE problem_id=?", (pid,))
    conn.commit()
    conn.close()
    return {"ok": True, "deleted": n}


@app.get("/api/reminder")
def reminder_get() -> dict:
    return {"time": _settings().get("reminder_time") or None, **reminder.status()}


@app.post("/api/reminder")
async def reminder_set(request: Request):
    body = await request.json()
    t = str(body.get("time") or "").strip()
    if t and not reminder.valid_time(t):
        return JSONResponse({"error": "time must look like 08:30"}, status_code=400)
    out = reminder.apply(t)
    if not out.get("ok"):
        return JSONResponse({"error": out.get("error", "could not schedule the reminder")}, status_code=500)
    _save_settings({"reminder_time": t})
    return out


learn_api.setup(db, DATA, lambda lesson: _lesson_digest(lesson))
from . import book_library
book_library.setup(DATA)
app.include_router(book_library.router)
from . import book_catalog
book_catalog.setup(DATA)
app.include_router(book_catalog.router)
app.include_router(library_folders.router)
app.include_router(screenshots_api.router)
app.include_router(sim_lab.router)
app.include_router(library_problems.router)
daily.setup(db, DATA)
app.include_router(daily.router)
app.include_router(daily_visuals.router)
app.include_router(dictation.router)
app.include_router(learn_api.router)
app.include_router(chapter_map.router)
from . import reading_history
app.include_router(reading_history.router)
app.include_router(workspace.router)
app.include_router(teacher.router)
app.include_router(visual_library.router)
app.include_router(study_guides.router)
course_cards.setup(db, DATA)
app.include_router(course_cards.router)
app.include_router(provider_connections.router)
from . import learner_profile, refreshers, self_update  # noqa: E402  (1.28 Settings: profile/class/Daily source, self-update; refresher cards)
app.include_router(learner_profile.router)
app.include_router(self_update.router)
app.include_router(refreshers.router)
app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
