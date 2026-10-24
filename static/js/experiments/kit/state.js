// Posted tasks yield to rendering/input without the nested setTimeout clamp.
// A single channel is shared; Node ports stay referenced only while work is queued.
let channel,turns=[];
export function yieldTask(){
 if(!channel){
  channel=new MessageChannel();
  channel.port1.onmessage=()=>{const resolve=turns.shift();resolve?.();if(!turns.length){channel.port1.unref?.();channel.port2.unref?.();}};
 }
 return new Promise(resolve=>{turns.push(resolve);channel.port1.ref?.();channel.port2.ref?.();channel.port2.postMessage(0);});
}

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
 if(model.sampleBatches){
  for(const batch of model.sampleBatches(values,{duration,interval,batchSize})){
   const end=batch.findIndex(sample=>sample.ended===true);yield end<0?batch:batch.slice(0,end+1);if(end>=0)return;
  }return;
 }
 const probe=model.create(values);let batch=[probe.sample()];if(batch[0].ended===true){yield batch;return;}
 const count=Math.ceil(duration/interval);
 for(let i=1;i<=count;i++){
  const target=Math.min(duration,i*interval);probe.step(target-probe.t);const sample=probe.sample();batch.push(sample);
  if(sample.ended===true){yield batch;return;}
  if(batch.length>=batchSize){yield batch;batch=[];}
 }
 if(batch.length)yield batch;
}

// Integrate into a private candidate. Only the newest completed seek can commit.
export class SeekController {
 constructor(){this.generation=0;this.pending=false;}
 cancel(){this.generation++;this.pending=false;}
 async run(model,values,target,{immediate=false,onComplete=()=>{},onError=()=>{},yieldTurn=yieldTask,budgetMs=14}={}){
  const generation=++this.generation;this.pending=true;
  const current=()=>generation===this.generation;
  try{
   if(!Number.isFinite(target)||target<0||target>60)throw RangeError('Choose a time from 0 to 60 seconds.');
   const candidate=model.create({...values});
   if(immediate)candidate.step(target);
   else while(candidate.t<target-1e-12&&candidate.sample?.().ended!==true){
    await yieldTurn();if(!current())return {cancelled:true};
    const deadline=performance.now()+Math.max(1,Math.min(20,budgetMs));
    do{const before=candidate.t,next=Math.min(target,before+1/60);candidate.step(next-before);if(!Number.isFinite(candidate.t)||candidate.t<=before&&candidate.sample?.().ended!==true)throw Error('This model could not advance to the requested time.');}
    while(candidate.t<target-1e-12&&candidate.sample?.().ended!==true&&performance.now()<deadline);
   }
   if(!current())return {cancelled:true};
   this.pending=false;onComplete(candidate);return {ok:true,instance:candidate};
  }catch(error){if(!current())return {cancelled:true};this.pending=false;onError(error);return {ok:false,error};}
  finally{if(current())this.pending=false;}
 }
}
