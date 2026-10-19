"""Start a hidden helper as this same user's limited UAC identity, never elevate.

Used when an administrator-run updater starts Kinema for a normal taskbar window.
Uses the verified same-user/session desktop shell as parent (CreateProcessW). No credentials,
command shell, or new logon is involved. Scheduled callers' linked tokens may be
identification-only, so those are deliberately not used to launch processes.
"""
# Windows documented desktop-parent launch pattern:
# https://devblogs.microsoft.com/oldnewthing/20190425-00/?p=102443
import os
import subprocess


def _api():
    import ctypes as c
    from ctypes import wintypes as w
    k=c.WinDLL('kernel32', use_last_error=True)
    a=c.WinDLL('advapi32', use_last_error=True)
    k.GetCurrentProcess.restype=w.HANDLE
    k.CloseHandle.argtypes=[w.HANDLE]
    k.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD]
    k.GetExitCodeProcess.argtypes=[w.HANDLE,c.POINTER(w.DWORD)]
    a.OpenProcessToken.argtypes=[w.HANDLE,w.DWORD,c.POINTER(w.HANDLE)]
    a.GetTokenInformation.argtypes=[w.HANDLE,c.c_int,c.c_void_p,w.DWORD,c.POINTER(w.DWORD)]
    return c,w,k,a


def _info(a,c,w,token,kind,value):
    size=w.DWORD()
    if not a.GetTokenInformation(token,kind,c.byref(value),c.sizeof(value),c.byref(size)):
        raise c.WinError(c.get_last_error())
    return value


def elevated():
    if os.name!='nt': return False
    c,w,k,a=_api();token=w.HANDLE()
    if not a.OpenProcessToken(k.GetCurrentProcess(),8,c.byref(token)):
        raise c.WinError(c.get_last_error())
    try: return bool(_info(a,c,w,token,20,w.DWORD()).value)
    finally: k.CloseHandle(token)


class LimitedProcess:
    def __init__(self,pid,handle,k,c,w):
        self.pid,self.handle,self.k,self.c,self.w=pid,handle,k,c,w

    def wait(self,timeout=50):
        result=self.k.WaitForSingleObject(self.handle,int(timeout*1000))
        if result==258:
            raise TimeoutError('The normal-user Kinema helper is still starting; it was left alone.')
        if result!=0: raise self.c.WinError(self.c.get_last_error())
        code=self.w.DWORD()
        if not self.k.GetExitCodeProcess(self.handle,self.c.byref(code)):
            raise self.c.WinError(self.c.get_last_error())
        return code.value

    def close(self):
        if self.handle: self.k.CloseHandle(self.handle);self.handle=None


def spawn_limited(args,*,cwd,env):
    """Lower privileges with a verified desktop parent; caller owns wait/close."""
    if os.name!='nt': raise OSError('Limited user launch is Windows-only.')
    c,w,k,a=_api();token=w.HANDLE();shell_token=w.HANDLE();shell_process=None;attributes=None;initialized=False
    class Startup(c.Structure):
        _fields_=[('cb',w.DWORD),('reserved',w.LPWSTR),('desktop',w.LPWSTR),('title',w.LPWSTR),
                  ('x',w.DWORD),('y',w.DWORD),('xsize',w.DWORD),('ysize',w.DWORD),
                  ('xchars',w.DWORD),('ychars',w.DWORD),('fill',w.DWORD),('flags',w.DWORD),
                  ('show',w.WORD),('reserved2size',w.WORD),('reserved2',c.c_void_p),
                  ('stdin',w.HANDLE),('stdout',w.HANDLE),('stderr',w.HANDLE)]
    class ProcessInfo(c.Structure):
        _fields_=[('process',w.HANDLE),('thread',w.HANDLE),('pid',w.DWORD),('tid',w.DWORD)]
    class StartupEx(c.Structure):
        _fields_=[('startup',Startup),('attributes',c.c_void_p)]
    k.CreateProcessW.argtypes=[w.LPCWSTR,w.LPWSTR,c.c_void_p,c.c_void_p,w.BOOL,w.DWORD,
                              c.c_void_p,w.LPCWSTR,c.POINTER(StartupEx),c.POINTER(ProcessInfo)]
    k.InitializeProcThreadAttributeList.argtypes=[c.c_void_p,w.DWORD,w.DWORD,c.POINTER(c.c_size_t)]
    k.UpdateProcThreadAttribute.argtypes=[c.c_void_p,w.DWORD,c.c_size_t,c.c_void_p,c.c_size_t,c.c_void_p,c.c_void_p]
    k.DeleteProcThreadAttributeList.argtypes=[c.c_void_p]
    if not a.OpenProcessToken(k.GetCurrentProcess(),8,c.byref(token)):
        raise c.WinError(c.get_last_error())
    try:
        if not _info(a,c,w,token,20,w.DWORD()).value:
            raise OSError('Caller already has normal user permissions.')
        u=c.WinDLL('user32',use_last_error=True)
        u.GetShellWindow.restype=w.HWND
        u.GetWindowThreadProcessId.argtypes=[w.HWND,c.POINTER(w.DWORD)]
        pid=w.DWORD();hwnd=u.GetShellWindow()
        if not hwnd: raise OSError('The normal Windows desktop is not available.')
        u.GetWindowThreadProcessId(hwnd,c.byref(pid))
        k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];k.OpenProcess.restype=w.HANDLE
        shell_process=k.OpenProcess(0x1080,False,pid.value)
        if not shell_process or not a.OpenProcessToken(shell_process,8,c.byref(shell_token)):
            raise c.WinError(c.get_last_error())
        def user(t):
            size=w.DWORD();a.GetTokenInformation(t,1,None,0,c.byref(size))
            buffer=c.create_string_buffer(size.value)
            if not a.GetTokenInformation(t,1,buffer,size,c.byref(size)):raise c.WinError(c.get_last_error())
            return buffer
        owner,desktop=user(token),user(shell_token)
        a.EqualSid.argtypes=[c.c_void_p,c.c_void_p]
        if not a.EqualSid(c.cast(owner,c.POINTER(c.c_void_p))[0],c.cast(desktop,c.POINTER(c.c_void_p))[0]):
            raise OSError('The Windows desktop belongs to a different user.')
        if _info(a,c,w,token,12,w.DWORD()).value != _info(a,c,w,shell_token,12,w.DWORD()).value:
            raise OSError('The Windows desktop belongs to a different session.')
        if _info(a,c,w,shell_token,20,w.DWORD()).value:
            raise OSError('A normal-user Windows desktop is required.')
        size=c.c_size_t()
        k.InitializeProcThreadAttributeList(None,1,0,c.byref(size))
        attributes=c.create_string_buffer(size.value)
        if not k.InitializeProcThreadAttributeList(attributes,1,0,c.byref(size)):
            raise c.WinError(c.get_last_error())
        initialized=True
        parent=w.HANDLE(shell_process)
        if not k.UpdateProcThreadAttribute(attributes,0,0x00020000,c.byref(parent),c.sizeof(parent),None,None):
            raise c.WinError(c.get_last_error())
        line=c.create_unicode_buffer(subprocess.list2cmdline([str(x) for x in args]))
        if len(line)>1024: raise ValueError('Kinema helper command is too long.')
        block=c.create_unicode_buffer('\0'.join(f'{key}={value}' for key,value in sorted(env.items(),key=lambda x:x[0].upper()))+'\0')
        si=StartupEx();si.startup.cb=c.sizeof(si);si.startup.flags=1;si.startup.show=0;si.attributes=c.cast(attributes,c.c_void_p)
        pi=ProcessInfo()
        if not k.CreateProcessW(str(args[0]),line,None,None,False,0x08080400,block,str(cwd),c.byref(si),c.byref(pi)):
            raise c.WinError(c.get_last_error())
        k.CloseHandle(pi.thread)
        return LimitedProcess(pi.pid,pi.process,k,c,w)
    finally:
        if initialized: k.DeleteProcThreadAttributeList(attributes)
        if shell_token: k.CloseHandle(shell_token)
        if shell_process: k.CloseHandle(shell_process)
        k.CloseHandle(token)
