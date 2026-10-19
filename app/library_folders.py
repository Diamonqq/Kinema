"""Named problem collections. Membership never owns or deletes original work."""
from __future__ import annotations

import json
import time
import uuid
from contextlib import closing

from fastapi import APIRouter, Body, HTTPException

from . import book_catalog, learn_api, library_problems

router = APIRouter(prefix='/api/library/folders')


def ensure_tables(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS library_folders(
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        created_ts REAL NOT NULL, updated_ts REAL NOT NULL)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS library_folder_items(
        folder_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
        snapshot TEXT NOT NULL, added_ts REAL NOT NULL,
        PRIMARY KEY(folder_id,kind,item_id))''')


def _name(value):
    if not isinstance(value, str) or any(ord(c) < 32 for c in value):
        raise HTTPException(400, 'Enter a folder name.')
    value = ' '.join(value.split())
    if not 1 <= len(value) <= 80:
        raise HTTPException(400, 'Use a folder name between 1 and 80 characters.')
    return value


def _folder(conn, fid):
    row = conn.execute('SELECT * FROM library_folders WHERE id=?', (fid,)).fetchone()
    if row is None:
        raise HTTPException(404, 'This folder is no longer available.')
    result = dict(row)
    result['count'] = conn.execute('SELECT COUNT(*) FROM library_folder_items WHERE folder_id=?', (fid,)).fetchone()[0]
    return result


def _reference(conn, kind, item_id):
    if kind not in ('book', 'chat', 'saved') or not isinstance(item_id, str) or not 1 <= len(item_id) <= 120:
        raise HTTPException(400, 'Choose a book question or saved problem.')
    if kind == 'book':
        try:
            row = book_catalog.item(item_id)
        except ValueError:
            raise HTTPException(404, 'This book question is not available.') from None
        return dict(kind=kind, id=item_id, title=row['title'], number=item_id,
                    thread_id=None, available=True)
    if kind == 'chat':
        row = conn.execute('''SELECT p.statement,p.number,p.thread_id FROM lib_problems p
            JOIN teacher_threads t ON t.id=p.thread_id WHERE p.id=?''', (item_id,)).fetchone()
        if row is not None:
            return dict(kind=kind, id=item_id, title=library_problems.presentation(row['statement'],photo=True)['title'],
                        number=row['number'], thread_id=row['thread_id'], available=True)
    else:
        row = conn.execute('SELECT title FROM problems WHERE id=?', (item_id,)).fetchone()
        if row is not None:
            return dict(kind=kind, id=item_id, title=library_problems.presentation(row['title'])['title'], number=None,
                        thread_id=None, available=True)
    raise HTTPException(404, 'The original problem is no longer available.')


def _detail(conn, fid):
    result = _folder(conn, fid)
    result['items'] = []
    for row in conn.execute('SELECT * FROM library_folder_items WHERE folder_id=? ORDER BY added_ts,rowid', (fid,)):
        try:
            item = _reference(conn, row['kind'], row['item_id'])
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            item = {**json.loads(row['snapshot']), 'available': False}
        result['items'].append({**item, 'added_ts': row['added_ts']})
    return result


@router.get('')
def list_folders():
    with closing(learn_api._db()) as conn:
        return {'items': [dict(r) for r in conn.execute('''SELECT f.*,
            (SELECT COUNT(*) FROM library_folder_items i WHERE i.folder_id=f.id) AS count
            FROM library_folders f ORDER BY f.updated_ts DESC,f.id''')]}


@router.post('')
def create_folder(payload: dict = Body(...)):
    name = _name(payload.get('name'))
    with closing(learn_api._db()) as conn:
        now, fid = time.time(), 'f' + uuid.uuid4().hex[:16]
        conn.execute('INSERT INTO library_folders VALUES(?,?,?,?)', (fid, name, now, now))
        conn.commit()
        return _folder(conn, fid)


@router.get('/{fid}')
def folder_detail(fid: str):
    with closing(learn_api._db()) as conn:
        return _detail(conn, fid)


@router.patch('/{fid}')
def rename_folder(fid: str, payload: dict = Body(...)):
    name = _name(payload.get('name'))
    with closing(learn_api._db()) as conn:
        conn.execute('BEGIN IMMEDIATE')
        _folder(conn, fid)
        conn.execute('UPDATE library_folders SET name=?,updated_ts=? WHERE id=?', (name, time.time(), fid))
        conn.commit()
        return _folder(conn, fid)


@router.delete('/{fid}')
def delete_folder(fid: str):
    with closing(learn_api._db()) as conn:
        conn.execute('BEGIN IMMEDIATE')
        _folder(conn, fid)
        conn.execute('DELETE FROM library_folder_items WHERE folder_id=?', (fid,))
        conn.execute('DELETE FROM library_folders WHERE id=?', (fid,))
        conn.commit()
    return {'ok': True}


@router.post('/{fid}/items')
def add_item(fid: str, payload: dict = Body(...)):
    with closing(learn_api._db()) as conn:
        conn.execute('BEGIN IMMEDIATE')
        _folder(conn, fid)
        item = _reference(conn, payload.get('kind'), payload.get('id'))
        now = time.time()
        added = conn.execute('INSERT OR IGNORE INTO library_folder_items VALUES(?,?,?,?,?)',
                            (fid, item['kind'], item['id'], json.dumps(item), now)).rowcount
        if added:
            conn.execute('UPDATE library_folders SET updated_ts=? WHERE id=?', (now, fid))
        conn.commit()
        return _detail(conn, fid)


@router.delete('/{fid}/items/{kind}/{item_id}')
def remove_item(fid: str, kind: str, item_id: str):
    with closing(learn_api._db()) as conn:
        conn.execute('BEGIN IMMEDIATE')
        _folder(conn, fid)
        removed = conn.execute('DELETE FROM library_folder_items WHERE folder_id=? AND kind=? AND item_id=?',
                               (fid, kind, item_id)).rowcount
        if removed:
            conn.execute('UPDATE library_folders SET updated_ts=? WHERE id=?', (time.time(), fid))
        conn.commit()
        return _detail(conn, fid)
