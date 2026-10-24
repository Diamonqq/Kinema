// Pure helpers: a rejected candidate never mutates the live experiment.
export function prepareCandidate(model,current,patch){
 const values={...current,...patch};
 const prepared=model.prepareUpdate?.(current,patch);
 if(prepared&&!prepared.ok)throw Error(prepared.error?.message||'This setup is not available.');
 const instance=prepared?.instance||model.create(values);
 instance.sample();instance.geometry();
 return {values,instance};
}

// No model work until the first next(). The caller yields between small batches.
export function* timelineBatches(model,values,{duration=60,interval=1/60,batchSize=8}={}){
 if(model.sampleBatches){yield* model.sampleBatches(values,{duration,interval,batchSize});return;}
 const probe=model.create(values);let batch=[probe.sample()];
 const count=Math.ceil(duration/interval);
 for(let i=1;i<=count;i++){
  const target=Math.min(duration,i*interval);probe.step(target-probe.t);batch.push(probe.sample());
  if(batch.length>=batchSize){yield batch;batch=[];}
 }
 if(batch.length)yield batch;
}

// Integrate into a private candidate. Only the newest completed seek can commit.
export class SeekController {
 constructor(){this.generation=0;this.pending=false;}
 cancel(){this.generation++;this.pending=false;}
 async run(model,values,target,{immediate=false,onComplete=()=>{},onError=()=>{},yieldTurn=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  const generation=++this.generation;this.pending=true;
  const current=()=>generation===this.generation;
  try{
   if(!Number.isFinite(target)||target<0||target>60)throw RangeError('Choose a time from 0 to 60 seconds.');
   const candidate=model.create({...values});
   if(immediate)candidate.step(target);
   else while(candidate.t<target-1e-12){
    await yieldTurn();if(!current())return {cancelled:true};
    const deadline=performance.now()+6;let steps=0;
    do{const before=candidate.t,next=Math.min(target,before+1/60);candidate.step(next-before);if(!Number.isFinite(candidate.t)||candidate.t<=before)throw Error('This model could not advance to the requested time.');steps++;}
    while(candidate.t<target-1e-12&&steps<8&&performance.now()<deadline);
   }
   if(!current())return {cancelled:true};
   this.pending=false;onComplete(candidate);return {ok:true,instance:candidate};
  }catch(error){if(!current())return {cancelled:true};this.pending=false;onError(error);return {ok:false,error};}
  finally{if(current())this.pending=false;}
 }
}
