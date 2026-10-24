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
