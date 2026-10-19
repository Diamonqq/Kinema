"""Run a private Kinema installation on this computer."""
from pathlib import Path
import argparse,os,sys,threading,webbrowser

def default_data():
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA',Path.home()/'AppData/Local'))/'Kinema'
    if sys.platform == 'darwin':
        return Path.home()/'Library/Application Support/Kinema'
    return Path(os.environ.get('XDG_DATA_HOME',Path.home()/'.local/share'))/'kinema'

def main():
    p=argparse.ArgumentParser(description='Start Kinema for this computer only.')
    p.add_argument('--port',type=int,default=8790)
    p.add_argument('--data',type=Path,default=default_data())
    p.add_argument('--no-browser',action='store_true')
    args=p.parse_args()
    if not 1024<=args.port<=65535:p.error('Choose a port between 1024 and 65535.')
    root=Path(__file__).resolve().parent
    os.chdir(root)
    os.environ['KINEMA_DATA']=str(args.data.expanduser().resolve())
    os.environ.setdefault('KINEMA_TASKS','off')
    os.environ.setdefault('KINEMA_REMINDER','off')
    if (root/'PUBLIC-DISTRIBUTION').is_file():os.environ['KINEMA_DISTRIBUTION']='public'
    try:import uvicorn
    except ImportError:raise SystemExit('Install the requirements first: python -m pip install -r requirements.txt')
    address='http://127.0.0.1:'+str(args.port)
    print('Kinema: '+address,flush=True)
    print('Your work is saved on this computer. Press Ctrl+C to close Kinema.',flush=True)
    if not args.no_browser:
        timer=threading.Timer(1.2,lambda:webbrowser.open(address));timer.daemon=True;timer.start()
    uvicorn.run('app.main:app',host='127.0.0.1',port=args.port,log_level='warning')

if __name__=='__main__':main()
