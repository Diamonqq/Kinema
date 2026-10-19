"""Reading exposure only. Never changes learner evidence or mastery."""
import time
from contextlib import contextmanager
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt
from . import prepared_lessons

router = APIRouter()


@contextmanager
def connection():
    from .main import db
    conn = db()
    try:
        with conn:
            conn.execute('CREATE TABLE IF NOT EXISTS reading_visits(id TEXT PRIMARY KEY, section_id TEXT NOT NULL, active_ms INTEGER NOT NULL, first_ts REAL NOT NULL, last_ts REAL NOT NULL)')
            yield conn
    finally:
        conn.close()


def snapshot(conn, ids=()):
    sections = {r['section_id']: dict(r) for r in conn.execute('''SELECT section_id,
        SUM(active_ms) AS active_ms, MIN(first_ts) AS first_ts, MAX(last_ts) AS last_ts
        FROM reading_visits GROUP BY section_id''')}
    ack = {}
    if ids:
        ack = {r['id']: r['active_ms'] for r in conn.execute(
            'SELECT id, active_ms FROM reading_visits WHERE id IN (' + ','.join('?' for _ in ids) + ')', list(ids))}
    return {'sections': sections, 'ack': ack}


class Visit(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r'^[a-zA-Z0-9-]+$')
    section_id: str = Field(min_length=1, max_length=30)
    active_ms: StrictInt = Field(ge=0, le=86_400_000)


class Visits(BaseModel):
    visits: list[Visit] = Field(min_length=1, max_length=100)


@router.get('/api/reading-history')
def history(pending: list[str] = Query(default=[])):
    if len(pending) > 100 or any(len(x) > 80 for x in pending):
        raise HTTPException(400, 'Too many pending reading visits.')
    with connection() as conn:
        return snapshot(conn, pending)


@router.post('/api/reading-history')
def record(body: Visits):
    valid = prepared_lessons.scopes()
    if any(v.section_id not in valid for v in body.visits):
        raise HTTPException(400, 'Unknown lesson section.')
    now = time.time()
    with connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        for v in body.visits:
            old = conn.execute('SELECT section_id FROM reading_visits WHERE id=?', (v.id,)).fetchone()
            if old and old['section_id'] != v.section_id:
                raise HTTPException(409, 'This reading visit belongs to another section.')
            conn.execute('''INSERT INTO reading_visits VALUES(?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET active_ms=MAX(reading_visits.active_ms,excluded.active_ms),
                last_ts=CASE WHEN excluded.active_ms>reading_visits.active_ms THEN excluded.last_ts ELSE reading_visits.last_ts END''',
                (v.id, v.section_id, v.active_ms, now, now))
        return snapshot(conn, [v.id for v in body.visits])
