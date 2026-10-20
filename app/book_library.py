"""Local, edition-checked book imports. Recipes contain PDF references, not book prose."""
from __future__ import annotations

from contextlib import closing
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import threading
import unicodedata
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

router = APIRouter()
CONTENT = Path(__file__).parent / 'content'
RECIPE = CONTENT / 'book_import/morin.json.gz'
_data: Path | None = None
_lock = threading.Lock()
MAX_UPLOAD = 40_000_000


def setup(data: Path):
    global _data
    _data = Path(data)


def normalize(text: str) -> str:
    return re.sub(r'(?<=\w)-\s+(?=\w)', '', unicodedata.normalize('NFKC', text)).replace('\u00ad', '')


def pdf_texts(path: Path):
    from . import notes
    import pypdfium2 as pdfium
    with notes._pdf_lock, pdfium.PdfDocument(str(path)) as doc:
        pages = []
        for i in range(len(doc)):
            page = doc[i]
            try:
                text = page.get_textpage()
                try:
                    pages.append(normalize(text.get_text_range()))
                finally:
                    text.close()
            finally:
                page.close()
    return pages


def active() -> Path | None:
    if _data is None:
        return None
    folder = _data / 'books/morin'
    try:
        name = json.loads((folder / 'active.json').read_text())['generation']
        if not re.fullmatch(r'pack-[a-f0-9]{32}', name):
            return None
        path = folder / name
        if (path / 'import.json').is_file() and (path / 'morin_book.sqlite3').is_file() and (path / 'source.pdf').is_file():
            return path
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def source_pdf() -> Path | None:
    folder = active()
    return folder / 'source.pdf' if folder else None


def content_path(relative: str, fallback: Path | None = None) -> Path:
    folder = active()
    candidate = folder / 'content' / relative if folder else None
    return candidate if candidate and candidate.is_file() else fallback or CONTENT / relative


def catalog_path(fallback: Path) -> Path:
    folder = active()
    return folder / 'morin_book.sqlite3' if folder else fallback


def _decode(value, pages):
    if isinstance(value, dict):
        if set(value) == {'$json', 'compact'}:
            return json.dumps(_decode(value['$json'], pages), ensure_ascii=False,
                              separators=(',', ':') if value['compact'] else (', ', ': '))
        if set(value) == {'$pdf'}:
            parts = []
            for op in value['$pdf']:
                if len(op) == 1 and isinstance(op[0], str):
                    parts.append(op[0])
                elif len(op) in (3, 4) and all(type(n) is int for n in op[:3]):
                    page, start, length = op[:3]
                    if not 0 <= page < len(pages) or start < 0 or length < 0 or start + length > len(pages[page]):
                        raise ValueError('The PDF text differs from this prepared edition.')
                    text = pages[page][start:start + length]
                    if len(op) == 4:
                        if isinstance(op[3], dict):
                            for before, after in op[3]['replace']:
                                text = text.replace(before, after)
                        else:
                            text = {'lower': str.lower, 'upper': str.upper, 'title': str.title}[op[3]](text)
                    parts.append(text)
                else:
                    raise ValueError('The import recipe is invalid.')
            return ''.join(parts)
        return {k: _decode(v, pages) for k, v in value.items()}
    if isinstance(value, list):
        return [_decode(v, pages) for v in value]
    return value


def _digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def import_pdf(path: Path) -> dict:
    if _data is None:
        raise ValueError('The book library is not ready.')
    recipe = json.loads(gzip.decompress(RECIPE.read_bytes()))
    source_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if source_sha != recipe['source_sha256']:
        raise ValueError('This PDF does not match the prepared Morin edition. Your library is unchanged. Use the same PDF edition as the prepared import.')
    with _lock:
        current = active()
        if current:
            receipt = json.loads((current / 'import.json').read_text())
            if receipt.get('recipe_sha256') == hashlib.sha256(RECIPE.read_bytes()).hexdigest():
                return {'book_id': 'morin', 'questions': 635, 'already_imported': True}
        pages = pdf_texts(path)
        if len(pages) != recipe['pages'] or _digest(pages) != recipe['text_sha256']:
            raise ValueError('This PDF reader produced different text. Your library is unchanged; the prepared import needs a compatible reader.')
        payload = _decode(recipe['payload'], pages)
        if _digest(payload) != recipe['payload_sha256']:
            raise ValueError('The prepared formatting did not verify. Your library is unchanged.')
        root = _data / 'books/morin'
        root.mkdir(parents=True, exist_ok=True)
        generation = 'pack-' + uuid.uuid4().hex
        with tempfile.TemporaryDirectory(prefix='.import-', dir=root) as temporary:
            stage = Path(temporary) / 'book'
            stage.mkdir()
            shutil.copyfile(path, stage / 'source.pdf')
            catalog = payload['catalog']
            with closing(sqlite3.connect(stage / 'morin_book.sqlite3')) as conn:
                conn.executescript(recipe['schema'])
                for table in ('metadata', 'items', 'solutions'):
                    columns = recipe['columns'][table]
                    conn.executemany(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", catalog[table])
                conn.commit()
                if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or conn.execute("SELECT count(*) FROM items WHERE statement_status='checked'").fetchone()[0] != 635:
                    raise ValueError('The prepared question library did not verify.')
            for name, value in payload['files'].items():
                relative = Path(name)
                if relative.is_absolute() or '..' in relative.parts or relative.suffix != '.json':
                    raise ValueError('Invalid prepared content path.')
                target = stage / 'content' / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
            receipt = {'book_id': 'morin', 'questions': 635, 'source_sha256': source_sha,
                       'recipe_sha256': hashlib.sha256(RECIPE.read_bytes()).hexdigest(), 'payload_sha256': recipe['payload_sha256']}
            (stage / 'import.json').write_text(json.dumps(receipt), encoding='utf8')
            stage.rename(root / generation)
        pointer = root / 'active.pending'
        pointer.write_text(json.dumps({'generation': generation}), encoding='utf8')
        pointer.replace(root / 'active.json')
        from . import daily, daily_visuals, problem_guidance
        daily.catalog.cache_clear()
        daily.config.cache_clear()
        problem_guidance._pack.cache_clear()
        for name in ('_load', 'load', 'scenes', 'manifest', 'catalog'):
            fn = getattr(daily_visuals, name, None)
            if hasattr(fn, 'cache_clear'):
                fn.cache_clear()
        return {'book_id': 'morin', 'questions': 635, 'already_imported': False}


@router.get('/api/books')
def books():
    from . import book_catalog, companion_questions
    available = catalog_path(book_catalog.DATABASE).is_file()
    return {'books': [
        {'id': 'kinema', 'title': 'Kinema practice', 'author': 'Original companion questions', 'available': True,
         'questions': len(companion_questions.items()), 'families':112, 'description': 'Original practice: 112 setups with parameter variants. Reference numbers are navigation labels; the questions differ from the textbook.'},
        {'id': 'morin', 'title': 'Introduction to Classical Mechanics', 'author': 'David Morin', 'available': available,
         'questions': 635 if available else 0, 'description': 'Your prepared textbook: questions, exercises, source figures and matched simulations.',
         'importable': RECIPE.is_file()}]}


@router.post('/api/books/import')
async def upload_book(request: Request):
    if _data is None:
        raise HTTPException(503, 'The book library is not ready.')
    folder = _data / 'book-imports'
    folder.mkdir(parents=True, exist_ok=True)
    # Only an owned temporary upload is removed; previous imports and source PDFs stay intact.
    with tempfile.TemporaryDirectory(prefix='upload-', dir=folder) as temporary:
        path = Path(temporary) / 'source.pdf'
        try:
            async with request.form(max_files=1, max_fields=2) as form:
                upload = form.get('file')
                if not hasattr(upload, 'read'):
                    raise HTTPException(400, 'Choose your textbook PDF.')
                size = 0
                with path.open('wb') as stream:
                    while block := await upload.read(1024 * 1024):
                        size += len(block)
                        if size > MAX_UPLOAD:
                            raise HTTPException(413, 'Choose a PDF smaller than 40 MB.')
                        stream.write(block)
            with path.open('rb') as stream:
                header = stream.read(5)
            if size < 5 or header != b'%PDF-':
                raise HTTPException(400, 'Choose a PDF file.')
            return await run_in_threadpool(import_pdf, path)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
