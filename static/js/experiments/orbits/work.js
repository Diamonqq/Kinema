// One cancellable, bounded computation. Publication always wakes a paused view.
export function runBatches(iterator,state,{signal,invalidate=()=>{},active=()=>true,
 onCleanup,schedule=f=>setTimeout(f,0),unschedule=clearTimeout,immediate=false}={}){
 let timer,unregister=()=>{};
 const detach=()=>{signal?.removeEventListener('abort',cancel);unregister();};
 function cancel(){if(state.cancelled)return;state.cancelled=true;unschedule(timer);iterator.return?.();detach();}
 state.cancel=cancel;state.signal=signal;
 const current=()=>!state.cancelled&&!signal?.aborted&&active();
 function next(){
  if(!current()){cancel();return;}
  try{
   const result=iterator.next();
   if(!current()){cancel();return;}
   if(result.done)state.done=true;
   else Object.assign(state,result.value);
   invalidate();
   if(!current()){cancel();return;}
   if(state.done)detach();else timer=schedule(next);
  }catch(e){
   if(!current()){cancel();return;}
   state.error=e.message;state.done=true;detach();invalidate();
  }
 }
 if(signal?.aborted){cancel();return state;}
 signal?.addEventListener('abort',cancel,{once:true});
 if(onCleanup)unregister=onCleanup(cancel);
 if(immediate)next();else timer=schedule(next);
 return state;
}
