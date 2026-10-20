"""Create a clean, reviewable source zip without the development history or private packs.

Reads only an explicit source allowlist. Never copies data, credentials, uploads,
the imported question database, assessments, or personal teaching records.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / 'app/content'
CONTENT_FILES = ('chapter_map.json','examples.json','scene_examples.json','questions.json','morin_lessons.json',
                 'topic_references.json','visual_library.json','class_courses.json')
TEXT_SUFFIXES = {'.py','.js','.css','.html','.json','.md','.txt','.svg','.webmanifest'}

def encoded(value):
    return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf8')

def collect(root=ROOT):
    root=Path(root).resolve(); files={}
    def add(path):
        path=Path(path)
        if path.is_symlink():raise ValueError('Symlink in export allowlist: '+path.name)
        files[path.relative_to(root).as_posix()]=path.read_bytes()
    for path in (root/'app').glob('*.py'):add(path)
    add(root/'app/sim_lab_anchors.json')
    for name in CONTENT_FILES:add(root/'app/content'/name)
    for path in (root/'static/js').rglob('*.js'):add(path)
    for path in (root/'static').glob('*.css'):add(path)
    for name in ('app.html','manifest.webmanifest'):add(root/'static'/name)
    for folder in ('icons','vthumbs','locales'):
        for path in (root/'static'/folder).rglob('*'):
            if path.is_file() and path.suffix.lower() in {'.svg','.png','.webp','.ico','.json'}:add(path)
    for path in (root/'static/vendor').rglob('*'):
        if path.is_file() and (path.suffix.lower() in {'.js','.css','.json','.woff','.woff2','.ttf','.txt'} or path.name=='LICENSE'):add(path)
    for name in ('requirements.txt','requirements-dev.txt','start.py'):add(root/name)
    if (root/'.gitattributes').is_file():add(root/'.gitattributes')
    for name in ('LICENSE','README.md'):add(root/'static/icons/providers'/name)
    for name in ('PUBLIC-SETUP.md','PROVIDERS.md','AGENT-SETUP.md'):add(root/'docs'/name)
    for name in ('provider_fixture.py','test_provider_connections.py','test_cloud_providers.py','test_provider_teacher_flow.py','test_cli_connections.py','test_cli_runners.py','test_cli_teacher_flow.py','test_localization.py','test_public_package.py','test_public_readiness.py','test_official_accounts.py','test_account.py','test_account_welcome.mjs'):
        path=root/'tests'/name
        if path.exists():add(path)
    add(root/'tools/package_public.py')
    morin=json.loads((root/'app/content/morin.json').read_text(encoding='utf8'))
    morin['book'].pop('pdf',None);morin['class_now']={}
    files['app/content/morin.json']=encoded(morin)
    files['app/content/study_courses.json']=encoded({'version':1,'courses':[{
        'id':'2301','title':'Mechanics','goal':'Learn to understand, set up and solve physics problems.',
        'learning_chapters':list(range(1,15)), 'material_refs':[],
        'next_step':'Follow the learner\'s chosen problem or topic; do not assume a course or exam.'}]})
    files['app/content/learning_profile.json']=encoded({'version':1,'style':{
        'start':'Teach one idea at a time on the learner\'s current problem. Follow their requested pace.',
        'worked_examples':'Define symbols, show each useful equation and explain why the step follows.',
        'prerequisites':'Check only the prerequisite needed for the current step. Do not infer mastery from reading.',
        'format':'Use clear prose and readable mathematics. Full walkthroughs are welcome when requested.'},
        'preferences':{},'known_progress':[]})
    for name,value in {'daily_problems.json':{'problems':[]},'daily_hooks.json':{'hooks':{}},
                       'daily_statements.json':{'statements':{}},'daily_visuals.json':{'version':2,'scenes':[]},
                       'daily_config.json':{'chapters':list(range(1,15)),'exclude_sections':[],'stars':[1,2,3],
                                            'think_seconds':600,'course_id':'2301','source_id':'morin'}}.items():
        files['app/content/'+name]=encoded(value)
    files['PUBLIC-DISTRIBUTION']=b'Kinema local single-user distribution\n'
    files['README.md']=(root/'README.md').read_bytes() if (root/'PUBLIC-DISTRIBUTION').exists() else (root/'docs/PUBLIC-SETUP.md').read_bytes()
    if (root/'PUBLIC-DISTRIBUTION').exists():
        for path in (root/'docs/images').glob('*'):
            if path.is_file() and path.suffix in {'.svg','.png','.webp'}:add(path)
        for name in ('CONTRIBUTING.md','SECURITY.md','THIRD-PARTY-NOTICES.md'):
            if (root/name).is_file():add(root/name)
    files['.gitignore']=b'.venv/\n__pycache__/\n*.py[cod]\n.env\n.env.*\ndata/\nbackups/\n*.db\n*.sqlite*\n*.key\n*.pem\n*.zip\n.DS_Store\n'
    validate(files)
    return files

def validate(files):
    # This catches accidental future additions as well as known private content.
    private=re.compile(r'(?i)(?:[A-Z]:[\\/](?:Kiwi|Users)[\\/]|@gmail\.com\b|sk-(?:ant-)?[A-Za-z0-9_-]{20,})')
    for name,data in files.items():
        if name.startswith(('data/','.git/','backups/')) or Path(name).suffix.lower() in {'.pdf','.db','.sqlite3','.pem','.key'}:
            raise ValueError('Private file in export: '+name)
        if Path(name).suffix.lower() in TEXT_SUFFIXES and name!='tools/package_public.py':
            text=data.decode('utf8')
            # Upstream attribution, reviewed against the pinned Three archive.
            # All other email/path/credential checks remain in force.
            if name=='static/vendor/three/examples/jsm/math/SimplexNoise.js':
                text=text.replace('banksean@gmail.com','')
            if private.search(text):raise ValueError('Private-looking text in export: '+name)
    required={'app/main.py','start.py','static/app.html','static/js/account_panel.js','static/js/language_panel.js','PUBLIC-DISTRIBUTION'}
    if required-files.keys():raise ValueError('Incomplete export: '+', '.join(sorted(required-files.keys())))

def package(output):
    output=Path(output).expanduser().resolve()
    if output.suffix.lower()!='.zip':raise ValueError('--output must name a .zip file')
    files=collect();manifest={name:hashlib.sha256(data).hexdigest() for name,data in sorted(files.items())}
    version=re.search(r'^VERSION = "([^"]+)"', (ROOT/'app/main.py').read_text(encoding='utf8'), re.M)
    if not version:raise ValueError('App version is missing')
    files['EXPORT-MANIFEST.json']=encoded({'version':version.group(1),'files':manifest})
    output.parent.mkdir(parents=True,exist_ok=True)
    temp=output.with_suffix('.zip.partial')
    with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in sorted(files.items()):z.writestr('Kinema/'+name,data)
    temp.replace(output)
    return {'path':str(output),'files':len(files),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True)
    print(json.dumps(package(p.parse_args().output),indent=2))
