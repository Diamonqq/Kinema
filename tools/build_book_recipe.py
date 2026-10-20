"""Prepare a reference-only import recipe from an already reviewed local catalog.

This developer tool never packages a PDF, question prose or figure pixels. Text
operators refer to word positions in the exact PDF supplied by the importing user.
Math notation, punctuation, short OCR fragments and isolated corrections are literal.
"""
from __future__ import annotations
import argparse
from collections import Counter
from contextlib import closing
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.book_library import normalize, pdf_texts, _decode, _digest

CORRECTIONS = {'sup', 'unravelling', 'moldable', 'incorporating', 'protons'}
MATH = re.compile(r'\$\$[\s\S]*?\$\$|\$[^$]*\$')
WORDS = re.compile(r'[A-Za-z]+|[^\W\d_A-Za-z]+')
FILES = ('daily_problems.json', 'daily_statements.json', 'daily_hooks.json', 'daily_visuals.json',
         'daily_config.json', 'prepared_problems.json', 'problem_guidance_exact.json', 'focus_states.json')


class Encoder:
    def __init__(self, pages):
        self.pages = pages
        self.exact, self.lower = {}, {}
        self.corrections = Counter()
        self.missing = Counter()
        for p, text in enumerate(pages):
            for m in WORDS.finditer(text):
                value = m[0]
                self.exact.setdefault(value, [p, m.start(), len(value)])
                self.lower.setdefault(value.lower(), (value, [p, m.start(), len(value)]))

    def text(self, value):
        ops = []
        def literal(text):
            if text:
                if ops and len(ops[-1]) == 1:
                    ops[-1][0] += text
                else:
                    ops.append([text])
        def prose(text):
            at = 0
            for match in WORDS.finditer(text):
                literal(text[at:match.start()])
                word = match[0]
                if word in self.exact:
                    ops.append(self.exact[word])
                elif normalize(word) in self.exact:
                    normal = normalize(word)
                    ops.append([*self.exact[normal], {'replace': [[normal, word]]}])
                elif word.lower() in self.lower:
                    original, ref = self.lower[word.lower()]
                    method = next((k for k, fn in (('lower', str.lower), ('upper', str.upper), ('title', str.title)) if fn(original) == word), None)
                    if method:
                        ops.append([*ref, method])
                    else:
                        raise ValueError('Unmatched capitalization: ' + word)
                elif len(word) <= 3 or word in CORRECTIONS:
                    literal(word)
                    self.corrections[word] += 1
                else:
                    # The original line extractor sometimes joined hyphenated compounds.
                    split = next((n for n in range(1, len(word)) if word[:n] in self.exact and word[n:] in self.exact), None)
                    if split:
                        ops.extend([self.exact[word[:split]], self.exact[word[split:]]])
                    else:
                        location = next(((p, text.find(word)) for p, text in enumerate(self.pages) if word in text), None)
                        if location:
                            ops.append([*location, len(word)])
                        else:
                            self.missing[word] += 1
                            literal(word)
                at = match.end()
            literal(text[at:])
        at = 0
        for match in MATH.finditer(value):
            prose(value[at:match.start()])
            literal(match[0])
            at = match.end()
        prose(value[at:])
        return {'$pdf': ops}


def build(catalog, pdf, content, output):
    pages = pdf_texts(pdf)
    encoder = Encoder(pages)
    with closing(sqlite3.connect(catalog)) as conn:
        columns, tables = {}, {}
        for table in ('metadata', 'items', 'solutions'):
            columns[table] = [r[1] for r in conn.execute('PRAGMA table_info(' + table + ')')]
            tables[table] = [list(r) for r in conn.execute('SELECT * FROM ' + table + ' ORDER BY 1')]
        schema = ';\n'.join(r[0] for r in conn.execute("SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND name IN ('metadata','items','solutions','items_chapter') AND sql IS NOT NULL")) + ';'
    grams = set()
    def terms(text):
        return re.findall('[a-z]+', MATH.sub('', text).lower())
    for row in tables['items']:
        words = terms(row[columns['items'].index('statement_md')])
        grams.update(tuple(words[i:i+10]) for i in range(len(words)-9))
    def protect(value, key=''):
        if isinstance(value, dict):
            if '$pdf' in value:
                return value
            return {k: protect(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [protect(v, key) for v in value]
        if isinstance(value, str):
            words = terms(value)
            if key in ('statement_md', 'display_statement_md') or any(tuple(words[i:i+10]) in grams for i in range(len(words)-9)):
                return encoder.text(value)
        return value
    payload = {'catalog': tables, 'files': {}}
    encoded = {'catalog': {}, 'files': {}}
    for table, rows in tables.items():
        encoded['catalog'][table] = []
        for row in rows:
            new = list(row)
            if table == 'items':
                for field in ('title', 'statement_md'):
                    index = columns[table].index(field)
                    new[index] = encoder.text(row[index])
                # Native checked text is authoritative. Old extraction artifacts are unnecessary.
                index = columns[table].index('raw_text')
                statement = row[columns[table].index('statement_md')]
                new[index] = encoder.text(statement)
                row[index] = statement
                for field in ('source_json', 'dependencies_json'):
                    index = columns[table].index(field)
                    parsed = json.loads(row[index])
                    compact = json.dumps(parsed, ensure_ascii=False, separators=(',', ':')) == row[index]
                    if not compact and json.dumps(parsed, ensure_ascii=False) != row[index]:
                        raise ValueError('Unsupported source JSON formatting.')
                    new[index] = {'$json': protect(parsed), 'compact': compact}
            encoded['catalog'][table].append(new)
    # Keep reviewed geometry/bindings and authored assistance with the private import.
    # Original prose in the Daily catalog is explicitly compiled into PDF operators.
    for name in FILES:
        value = json.loads((content / name).read_text(encoding='utf8'))
        payload['files'][name] = value
        encoded['files'][name] = json.loads(json.dumps(value))
        if name == 'daily_problems.json':
            for row in encoded['files'][name]['problems']:
                for key in ('text', 'title'):
                    if row.get(key):
                        row[key] = encoder.text(row[key])
        elif name == 'daily_statements.json':
            # The canonical pack may either be keyed directly or under statements.
            for row in encoded['files'][name].get('statements', encoded['files'][name]).values():
                if isinstance(row, dict) and row.get('statement_md'):
                    row['statement_md'] = encoder.text(row['statement_md'])
    for path in sorted((content / 'chapter_experiments').glob('*.json')):
        name = 'chapter_experiments/' + path.name
        payload['files'][name] = json.loads(path.read_text(encoding='utf8'))
        encoded['files'][name] = payload['files'][name]
    encoded['files'] = protect(encoded['files'])
    recipe = {'version': 1, 'book_id': 'morin', 'source_sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
              'pages': len(pages), 'text_sha256': _digest(pages), 'payload_sha256': _digest(payload),
              'schema': schema, 'columns': columns, 'payload': encoded}
    if encoder.missing:
        raise ValueError('Unmatched PDF words: ' + json.dumps(dict(encoder.missing), ensure_ascii=False))
    if _decode(encoded, pages) != payload:
        raise ValueError('Lossless reconstruction failed.')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(gzip.compress(json.dumps(recipe, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
    return {'questions': len(tables['items']), 'files': len(payload['files']), 'bytes': output.stat().st_size,
            'source_sha256': recipe['source_sha256'], 'payload_sha256': recipe['payload_sha256'],
            'isolated_corrections': dict(encoder.corrections)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('catalog', 'pdf', 'content', 'output'):
        parser.add_argument('--' + arg, type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.catalog, args.pdf, args.content, args.output), indent=2))
