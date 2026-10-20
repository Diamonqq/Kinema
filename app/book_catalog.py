"""Versioned Morin questions and private source solutions, independent of saves.

Opening/searching is read-only. Only question/figure/setup regions are exposed by
the public image route. Tutor reference paths are supplied internally, by exact
question identity; an Exercise never acquires a fictitious printed solution.
"""
from __future__ import annotations
import hashlib, json, math, re, sqlite3, threading
from contextlib import closing
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from . import teacher_content, prepared_problems, chapter_experiments
from . import book_library

router = APIRouter()
DATABASE = Path(__file__).parent/'content/morin_book.sqlite3'
_data = Path(__file__).resolve().parents[1]/'data'
_image_lock = threading.Lock()
PUBLIC_IMAGES = {'question', 'figure', 'setup'}


def setup(data_dir: Path):
    global _data
    _data = Path(data_dir)


def database():
    return book_library.catalog_path(DATABASE)


def _db():
    if not database().is_file():
        raise ValueError('The private textbook library is not installed. You can upload a problem to a new chat.')
    conn = sqlite3.connect(database().resolve().as_uri()+'?mode=ro',uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def metadata():
    if not database().is_file():
        return {'available': False, 'note': 'The textbook question pack is a private import. Upload your own problem in a new chat.'}
    with closing(_db()) as conn:
        return {r['key']: json.loads(r['value']) for r in conn.execute('SELECT key,value FROM metadata')}


def item(pid: str):
    if isinstance(pid, str) and pid.startswith('k:'):
        from . import companion_questions
        return companion_questions.item(pid)
    if not isinstance(pid,str) or len(pid)>12:
        raise ValueError('Choose a numbered Morin question.')
    with closing(_db()) as conn:
        row=conn.execute('SELECT * FROM items WHERE id=?',(pid,)).fetchone()
    if row is None:
        raise ValueError('That question is not in this Morin edition.')
    result=dict(row)
    result['source']=json.loads(result.pop('source_json'))
    result['dependencies']=json.loads(result.pop('dependencies_json'))
    return result


def _prepared(row, source_sha=None):
    if not database().is_file():
        return {'prepared_help': prepared_problems.unavailable()}
    return prepared_problems.get(row, source_sha or metadata().get('source_sha256'))


def _summary(row, source_sha=None):
    result = {key: row[key] for key in ('id','kind','chapter','number','title','section_id','stars')}
    from . import daily_visuals
    result.update(book_id='morin',reference_number=row['id'])
    result['visual_available'] = bool(row['legacy_daily_id']) and row['id'] in daily_visuals.ready_ids()
    result['visual_available'] = result['visual_available'] or bool(chapter_experiments.get(row, source_sha or metadata().get('source_sha256')))
    result['prepared_solution'] = _prepared(row, source_sha)['prepared_help']['available']
    return result


def search(chapter: int|None=None, kind: str|None=None, query: str='', offset: int=0, limit: int=60, prepared: bool|None=None, visual: bool|None=None, book: str='morin'):
    if book == 'kinema':
        from . import companion_questions
        return companion_questions.search(chapter, kind, query, offset, limit, prepared, visual)
    if book != 'morin':
        raise ValueError('Choose an available book.')
    if chapter is not None and chapter not in range(1,15):
        raise ValueError('Choose a chapter from 1 to 14.')
    if kind not in (None,'problem','exercise'):
        raise ValueError('Choose Problems or Exercises.')
    query=(query or '').strip()[:160]
    where,args=[],[]
    if chapter is not None: where.append('chapter=?');args.append(chapter)
    if kind: where.append('kind=?');args.append(kind)
    if query:
        pattern='%'+query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        where.append("(id LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR raw_text LIKE ? ESCAPE '\\')")
        args.extend([pattern]*3)
    clause=' WHERE '+' AND '.join(where) if where else ''
    limit=max(1,min(int(limit),100));offset=max(0,int(offset))
    if not database().is_file():
        return {'items': [], 'total': 0, 'prepared_total': 0, 'visual_total': 0, 'offset': offset, 'limit': limit, 'next_offset': None}
    source_sha=metadata().get('source_sha256')
    with closing(_db()) as conn:
        rows=conn.execute('SELECT * FROM items'+clause+' ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,chapter,number',args+[query]).fetchall()
    summaries=[_summary(r,source_sha) for r in rows]
    prepared_total=sum(r['prepared_solution'] for r in summaries)
    if prepared is not None:
        summaries=[r for r in summaries if r['prepared_solution'] is prepared]
    visual_total=sum(r['visual_available'] for r in summaries)
    if visual is not None:
        summaries=[r for r in summaries if r['visual_available'] is visual]
    total=len(summaries)
    return {'items':summaries[offset:offset+limit],'total':total,'prepared_total':prepared_total,'visual_total':visual_total,'offset':offset,'limit':limit,
            'next_offset':offset+limit if offset+limit<total else None}


def _regions(row, kind):
    if kind=='question': return row['source']['question']
    if kind=='figure': return row['source']['figures']
    if kind=='setup': return row['source'].get('setup',[])
    if kind in ('solution','solution_figure'):
        with closing(_db()) as conn:
            value=conn.execute('SELECT source_json FROM solutions WHERE item_id=?',(row['id'],)).fetchone()
        if not value: return []
        src=json.loads(value[0])
        return src['candidate_crops'] if kind=='solution' else src.get('candidate_figures',[])
    raise ValueError('Unknown source image kind.')


def related_items(row):
    ids=[]
    for d in row['dependencies'].get('explicit',[]):
        if d['type'].lower().rstrip('s') in ('problem','exercise'): ids.append(d['target'])
    text=row['raw_text']
    if re.search(r'\bprevious (?:problem|exercise)\b',text,re.I):
        ids.append(f"{row['chapter']}.{row['number']-1}")
    for match in re.finditer(r'\b(?:Problems|Exercises)\s+((?:\d+\.\d+)(?:(?:\s*,\s*|\s+and\s+)\d+\.\d+)*)',text):
        ids.extend(re.findall(r'\d+\.\d+',match[1]))
    found=[];seen={row['id']}
    for pid in ids:
        if pid in seen:continue
        try:target=item(pid)
        except ValueError:continue
        seen.add(pid);found.append(target)
    return found


def public_item(pid: str):
    if isinstance(pid, str) and pid.startswith('k:'):
        from . import companion_questions
        return companion_questions.public_item(pid)
    row=item(pid)
    result=_summary(row)
    result.update(label='Morin '+pid,book_title='Introduction to Classical Mechanics',statement_md=row['statement_md'],statement_status=row['statement_status'],
                  source_revision=row['content_sha'],pages=row['source']['pages'],
                  source_url=teacher_content.source_url('morin',row['source']['pages'][0],'2301'))
    result['images']={kind:[{'url':f'/api/book/items/{pid}/images/{kind}/{i}.png',
                            'page':r['page'],'label':r.get('label',f'Question {pid}'),
                            'width_ratio':r['x1']-r['x0'],'height_ratio':r['y1']-r['y0']}
                           for i,r in enumerate(_regions(row,kind))] for kind in PUBLIC_IMAGES}
    result['related_questions']=[_summary(target) for target in related_items(row)]
    result['simulation_id']=None
    result['visual']=None
    if row['legacy_daily_id']:
        from . import daily_visuals
        if pid in daily_visuals.ready_ids():
            result['simulation_id']=pid
            result['visual']=daily_visuals.payload(pid,False)
    result['starter']='Help me set up this problem.'
    if result['visual'] is None:
        result['visual'] = chapter_experiments.get(row, metadata().get('source_sha256'))
        if result['visual']:
            result['simulation_id'] = pid
            result['source_edition'] = metadata().get('source_sha256')
    result.update(_prepared(row))
    from . import problem_guidance
    result['guidance'] = problem_guidance.for_question(row, metadata().get('source_sha256'))
    return result


def notes_scope(pid: str):
    if pid.startswith('k:'):
        return None
    from . import chapter_scope
    row=item(pid)
    chosen=chapter_scope.canonical(chapter_scope.launch(row['chapter'],[row['section_id']])) if row['section_id'] else None
    return chosen or chapter_scope.canonical(chapter_scope.launch(row['chapter']))


def visual_state(pid: str, proposed):
    if pid.startswith('k:'):
        return None
    """Bounded report of the exact prepared setup; never inferred from its availability."""
    from . import daily_visuals
    if isinstance(proposed, dict) and proposed.get('kind') == 'chapter_experiment':
        row = item(pid)
        spec = chapter_experiments.get(row, metadata().get('source_sha256'))
        if not spec or proposed.get('problem') != pid or proposed.get('source_revision') != row['content_sha']:
            return None
        params = proposed.get('params') or {}
        if not isinstance(params, dict): return None
        bounded = {}
        for p in spec.get('parameters', []):
            v = params.get(p['key'])
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not p['min'] <= v <= p['max']:
                return None
            if p.get('choices') and v not in [choice['value'] for choice in p['choices']]: return None
            step = p.get('step', 0)
            if step and not math.isclose((v-p['min'])/step, round((v-p['min'])/step), abs_tol=1e-6): return None
            bounded[p['key']] = v
        view = proposed.get('view')
        native = spec.get('native_lesson')
        allowed_views = [v['id'] for v in spec.get('views', [])]
        if native: allowed_views += ['hero', 'side', 'top', 'closeup', 'region', 'orbit']
        if view not in allowed_views: return None
        t = proposed.get('t')
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t) or not 0 <= t <= 1e8: return None
        result = {'kind': spec['kind'], 'problem': pid, 'source_revision': row['content_sha'], 't': t,
                  'playing': proposed.get('playing') is True, 'view': view,
                  'breakdown': proposed.get('breakdown') is True, 'params': bounded}
        if native:
            scene = native.get('visualization', {}).get('scene') or {}
            subject = proposed.get('forceBody')
            if subject is not None and subject not in [b['id'] for b in scene.get('bodies', [])]: return None
            loads = proposed.get('forceLoads')
            labels = {f.get('label') for f in scene.get('forces', [])}
            if loads is not None and (not isinstance(loads, list) or len(loads)>32 or
                                      any(not isinstance(x,str) or x not in labels for x in loads)): return None
            result.update(forces=proposed.get('forces') is True, forceBody=subject, forceLoads=loads)
            region = proposed.get('region')
            if region is not None:
                targets = [v.get('target') for v in spec.get('views', []) if v.get('target')]
                target = next((v for v in targets if v.get('name') == region.get('name')), None) if isinstance(region,dict) else None
                point = region.get('point') if isinstance(region,dict) else None
                size = region.get('size') if isinstance(region,dict) else None
                if (not target or point != target.get('point') or isinstance(size,bool) or
                        not isinstance(size,(float,int)) or not math.isfinite(size) or not 0<size<1e6): return None
                result['region'] = {'name':target['name'], 'point':point, 'size':size}
        return result
    if not isinstance(proposed,dict) or proposed.get('problem')!=pid or pid not in daily_visuals.ready_ids():return None
    numeric=lambda key: float(proposed[key]) if isinstance(proposed.get(key),(int,float)) and not isinstance(proposed.get(key),bool) and math.isfinite(proposed[key]) else None
    return {'problem':pid,'playing':proposed.get('playing') is True,'t':numeric('t'),
            'speed':numeric('speed'),'expanded':proposed.get('expanded') is True,
            'forces':proposed.get('forces') is True,'breakdown':proposed.get('breakdown') is True,'variant':str(proposed.get('variant') or '')[:60],
            'explore':numeric('explore'),
            'view':str(proposed.get('view') or '')[:60],
            'labels':[str(s)[:80] for s in proposed.get('labels',[])[:40]] if isinstance(proposed.get('labels'),list) else [],
            # the close-up actually on screen (window.KinemaFocus / viewer.state.focus), or None
            'focus':daily_visuals.focus_report(pid,proposed.get('focus'))}


def _source():
    c=teacher_content.course('2301')
    ref=teacher_content._ref(c,'morin')
    path=teacher_content._ref_path(ref)
    if not path.is_file():raise FileNotFoundError('The Morin source PDF is unavailable.')
    stat=path.stat()
    if _source_hash(str(path.resolve()),stat.st_size,stat.st_mtime_ns)!=metadata()['source_sha256']:
        raise ValueError('The Morin source differs from this question edition.')
    return path


@lru_cache(maxsize=4)
def _source_hash(path,size,mtime):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def crop_file(pid: str,kind: str,index: int, *, detail: bool = False):
    if pid.startswith('k:'):
        raise ValueError('This original practice question has no source scan.')
    row=item(pid);regions=_regions(row,kind)
    if not isinstance(index,int) or not 0<=index<len(regions):
        raise ValueError('That source image is unavailable.')
    source=_source()
    region=regions[index]
    if not (1<=region['page']<=720 and 0<=region['x0']<region['x1']<=1 and 0<=region['y0']<region['y1']<=1):
        raise ValueError('Invalid source region.')
    scale = 5.2 if detail else 2.6
    fingerprint=hashlib.sha256(json.dumps([row['source_sha'],region,scale],sort_keys=True).encode()).hexdigest()[:20]
    folder=_data/'book-images'
    target=folder/f'{pid}-{kind}-{index}-{fingerprint}.png'
    with _image_lock, teacher_content.notes._pdf_lock:
        if target.is_file():return target
        import pypdfium2 as pdfium
        folder.mkdir(parents=True,exist_ok=True)
        doc=pdfium.PdfDocument(str(source))
        try:
            page=doc[region['page']+17]
            try:
                bitmap=page.render(scale=scale)
                try: image=bitmap.to_pil().convert('RGB')
                finally:bitmap.close()
            finally:page.close()
        finally:doc.close()
        box=(math.floor(region['x0']*image.width),math.floor(region['y0']*image.height),
             math.ceil(region['x1']*image.width),math.ceil(region['y1']*image.height))
        image=image.crop(box)
        # Keep complete region and stable dimensions. Trimming can cut faint math
        # strokes or turn narrow labels into enormous enlarged source pictures.
        temporary=target.with_suffix('.pending.png')
        image.save(temporary)
        temporary.replace(target)
    return target


def private_context(pid: str):
    """For the tutor only. Never return this object from a public route."""
    if pid.startswith('k:'):
        from . import companion_questions
        return companion_questions.private_context(pid)
    row=item(pid)
    with closing(_db()) as conn:
        solution=conn.execute('SELECT origin FROM solutions WHERE item_id=?',(pid,)).fetchone()
    image_paths=[];assignments=[]
    def attach(target,kind):
        for i,region in enumerate(_regions(target,kind)):
            image_paths.append(str(crop_file(target['id'],kind,i)))
            assignments.append({'image':len(image_paths),'item_id':target['id'],'kind':kind,
                                'page':region['page'],'label':region.get('label')})
    for kind in ('question','figure','setup','solution','solution_figure'):
        attach(row,kind)
    dependencies=[]
    for target in related_items(row):
        dependencies.append({**_summary(target),'statement':target['statement_md'] or target['raw_text'],
                             'source_pages':target['source']['pages']})
        # Include glyph authority until native text is prepared. References do not recurse.
        if not target['statement_md']:attach(target,'question')
        attach(target,'figure')
    return {'id':pid,'kind':row['kind'],'title':row['title'],
            'statement':row['statement_md'] or row['raw_text'],
            'statement_verified':row['statement_status']=='checked',
            'solution_origin':solution['origin'] if solution else 'unavailable',
            'images':image_paths,'source_images':assignments,'source_revision':row['content_sha'],
            'related_questions':dependencies,'source_references':row['dependencies'].get('explicit',[]),
            'prepared_help':_prepared(row)['prepared_help'],
            'instruction':'Question and figure images are the glyph authority. Printed solution images, when present, '
                'are your private reference. Teach this exact setup one step at a time; never ask the student to read '
                'the book solution. This Exercise has no printed solution if solution_origin is unavailable; '
                'derive and check your reasoning instead of claiming an official answer. Ask one useful question, '
                'or give one small hint when requested. Opening the problem is not learning evidence.'}


@router.get('/api/book/catalog')
def api_catalog(chapter:int|None=None,kind:str|None=None,q:str='',offset:int=0,limit:int=60,prepared:bool|None=None,visual:bool|None=None,book:str='morin'):
    try:return {**search(chapter,kind,q,offset,limit,prepared,visual,book),'book':metadata() if book=='morin' else {'id':'kinema','available':True,'title':'Kinema practice'}}
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc


@router.get('/api/book/items/{pid}')
def api_item(pid:str):
    try:return public_item(pid)
    except ValueError as exc:raise HTTPException(404,str(exc)) from exc


@router.get('/api/book/items/{pid}/images/{kind}/{index}.png')
def api_image(pid:str,kind:str,index:int,detail:bool=False):
    if kind not in PUBLIC_IMAGES:raise HTTPException(404,'Source image unavailable.')
    try:return FileResponse(crop_file(pid,kind,index,detail=detail),media_type='image/png',headers={'Cache-Control':'private, max-age=3600'})
    except (ValueError,FileNotFoundError) as exc:raise HTTPException(404,str(exc)) from exc
