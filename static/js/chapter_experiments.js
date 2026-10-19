import {esc,mdlite,math} from './md.js';
import {controlIcon} from './icons.js';
import {statementDigest} from './chapter_experiments/source_identity.js';
import {chapterNativeControls} from './chapter_experiments/native_controls.js';

// A failed module request is cached by the browser. Retry must request a fresh
// URL after that failure; ordinary successful mounts retain the normal module.
const packRetries=new Map();
async function loadPack(renderer){const attempt=packRetries.get(renderer)||0,url=new URL(`./chapter_experiments/${renderer}.js`,import.meta.url);if(attempt)url.searchParams.set('retry',String(attempt));try{return await import(url.href)}catch(error){packRetries.set(renderer,attempt+1);throw error}}

export async function matchesProblem(spec,p){
 const s=spec?.source;
 if(!s||spec.kind!=='chapter_experiment'||spec.schema!==1||spec.status!=='implemented'||spec.id!==p?.id||spec.problem!==p.id||s.id!==p.id||s.kind!==p.kind||s.chapter!==p.chapter||s.number!==p.number||s.title!==p.title||s.section_id!==p.section_id||s.content_sha256!==p.source_revision||s.source_sha256!==p.source_edition||spec.renderer!==`ch${String(p.chapter).padStart(2,'0')}`)return false;
 return statementDigest(p.statement_md||'')===s.statement_sha256;
}

export function nativeIntegration(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='integration_hz,sample_hz'||![1200,2400,4800,9600].includes(value.integration_hz)||![120,240,600,1200].includes(value.sample_hz)||value.integration_hz%value.sample_hz!==0)throw Error('Unsupported native integration settings. Reopen this question.');
 return {dt:1/value.integration_hz,sample_hz:value.sample_hz};
}
export function preparedNativeLesson(spec){
 if(!Object.hasOwn(spec,'native_integration'))return spec.native_lesson;
 // API source/lesson verification happens before publishing the authored pack.
 // Recheck its source binding before copying chapter-only runtime hints.
 const proof=spec.native_verification;
 if(spec.kind!=='chapter_experiment'||spec.native_lesson?.visualization?.kind!=='mechanics'||!proof||!/^[a-f0-9]{64}$/.test(proof.lesson_sha256)||proof.statement_sha256!==spec.source?.statement_sha256||!proof.constraint_checks?.length||!proof.numeric_checks?.length)throw Error('Native precision no longer matches this question. Reopen it from Chapters.');
 const runtime=nativeIntegration(spec.native_integration),lesson=structuredClone(spec.native_lesson),scene=lesson.visualization.scene;
 if(Object.hasOwn(scene,'dt')||Object.hasOwn(scene,'sample_hz'))throw Error('Unexpected native runtime fields in the prepared lesson.');
 Object.assign(scene,runtime);return lesson;
}

export async function mountNativeExperiment(host,spec,teacher,{live=()=>host.isConnected,onHelpReveal}={}){
 const owner='chapter-experiment:'+spec.id;
 const result=await teacher.stage.load(preparedNativeLesson(spec),owner,{live:()=>live()&&host.isConnected,prepared:true,intent:'practice',onHelpReveal});
 if(!live()||!host.isConnected)throw Error('The question changed while opening its apparatus.');
 if(!result.ok)throw Error(result.error||'The apparatus could not open.');
 teacher.quietly(()=>{teacher.artifact.configure(result.kind,spec.title);teacher.artifact.setStep({kind:'native',title:spec.title,caption:spec.description});teacher.artifact.mountInline(host);teacher.artifact.open(true,false)});
 teacher.stage.libraryControls?.({forces:result.kind==='mechanics',intent:'practice'});
 const controls=chapterNativeControls(host,spec,teacher.stage);
 return {get state(){const s=teacher.stage.state();return {...s,view:s.camera===null?'orbit':controls.view||s.camera||spec.views?.[0]?.id,problem:spec.id,kind:spec.kind,source_revision:spec.source.content_sha256,breakdown:controls.breakdown||s.breakdown===true,params:Object.fromEntries((spec.parameters||[]).map(p=>[p.key,p.value]))}},resize(){teacher.stage.refit?.()},setView(v){if(!controls.setView?.(v))teacher.stage.apply?.({camera:v,playing:false})},setTime(t){teacher.stage.apply?.({time:t,playing:false})},pause(){controls.close();teacher.stage.apply?.({playing:false})},destroy(){controls.destroy();if(teacher.stage.owner()===owner)teacher.quietly(()=>{teacher.artifact.open(false,false);teacher.artifact.mountInline(null)})}};
}

export async function mountChapterExperiment(host,spec,{problem,teacher,live=()=>host.isConnected,onHelpReveal}={}){
 if(!await matchesProblem(spec,problem))throw Error('The experiment no longer matches this question. Reopen it from Chapters.');
 if(!document.querySelector('link[data-chapter-experiments]')){const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('../chapter_experiments.css',import.meta.url).href;css.dataset.chapterExperiments='';document.head.append(css)}
 if(!live())throw Error('This question is no longer open.');
 if(spec.native_lesson)return mountNativeExperiment(host,spec,teacher,{live,onHelpReveal});
 if(!/^ch(0[1-9]|1[0-4])$/.test(spec.renderer))throw Error('Unsupported experiment pack.');
 const pack=await loadPack(spec.renderer),model=pack.createExperiment(spec);
 if(!live())throw Error('This question is no longer open.');
 let t=0,playing=false,view=spec.views?.[0]?.id||'setup',breakdown=false,alive=true,frame=null,last=null;
 const params=Object.fromEntries((spec.parameters||[]).map(p=>[p.key,p.value]));
 const duration=()=>Math.max(1e-9,typeof model.duration==='function'?model.duration(params):model.duration||10);
 const labelValue=(p,value)=>p.choices?.find(c=>Number(c.value)===Number(value))?.label||`${Number(Number(value).toFixed(4))} ${p.unit||''}`;
 host.innerHTML=`<section class="ce-viewer" aria-label="${esc(spec.title)} interactive experiment"><p class="ce-intro">${esc(spec.description)}</p><div class="ce-canvas"><canvas role="img" aria-label="${esc(spec.title)} apparatus and quantitative diagram"></canvas></div><p class="ce-readout" aria-live="off"></p><div class="ce-transport"><button type="button" data-ce="play" aria-label="Play">${controlIcon('play')}<span>Play</span></button><button type="button" data-ce="reset" aria-label="Reset experiment">${controlIcon('reset')}<span>Reset</span></button><label class="ce-time">Time<input data-ce="time" aria-label="Experiment time" type="range" min="0" max="${duration()}" step="0.001" value="0"></label><output data-ce="clock">0.00 s</output></div><div class="ce-options"><div class="ce-views" role="group" aria-label="Experiment views">${(spec.views||[{id:'setup',label:'Full setup'}]).map(v=>`<button type="button" data-ce="view" data-view="${esc(v.id)}" aria-pressed="${v.id===view}">${esc(v.label)}</button>`).join('')}</div>${spec.breakdown?.length?'<button type="button" data-ce="breakdown" aria-expanded="false">Breakdown</button>':''}</div><div class="ce-parameters">${(spec.parameters||[]).map(p=>`<label><span>${esc(p.label)} <output data-param-value="${esc(p.key)}">${esc(labelValue(p,p.value))}</output></span>${p.choices?.length?`<select data-param="${esc(p.key)}" aria-label="${esc(p.label)}">${p.choices.map(v=>`<option value="${Number(v.value)}" ${Number(v.value)===p.value?'selected':''}>${esc(v.label)}</option>`).join('')}</select>`:`<input data-param="${esc(p.key)}" aria-label="${esc(p.label)}" type="range" min="${Number(p.min)}" max="${Number(p.max)}" step="${Number(p.step)}" value="${Number(p.value)}">`}</label>`).join('')}</div><div class="ce-breakdown mdb" hidden>${(spec.breakdown||[]).map(s=>`<h4>${esc(s.title)}</h4>${mdlite(s.body)}`).join('')}</div></section>`;
 const root=host.querySelector('.ce-viewer'),canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),readout=root.querySelector('.ce-readout'),time=root.querySelector('[data-ce=time]'),clock=root.querySelector('[data-ce=clock]'),play=root.querySelector('[data-ce=play]');
 const expand=document.createElement('button');expand.type='button';expand.className='ce-expand';expand.textContent='Expand diagram';expand.hidden=true;expand.addEventListener('click',()=>host.closest('.lr-visual')?.querySelector('[data-reading=visual-expand]')?.click());canvas.parentElement.append(expand);
 host.classList.add('ce-host');root.setAttribute('aria-description',spec.description);
 const parameterBox=root.querySelector('.ce-parameters'),breakdownBox=root.querySelector('.ce-breakdown');parameterBox.hidden=true;
 if(spec.parameters?.length)root.querySelector('.ce-options').insertAdjacentHTML('beforeend','<button type="button" data-ce="adjust" aria-expanded="false">Adjust</button>');
 let popup=null,popupKind=null,popupAnchor=null;
 function closePopup({focus=false}={}){if(!popup)return;const content=popup.querySelector('.ce-popup-content').firstElementChild;if(content){content.hidden=true;root.append(content)}popup.remove();popup=null;popupAnchor?.setAttribute('aria-expanded','false');if(focus&&popupAnchor?.isConnected)popupAnchor.focus();popupAnchor=null;popupKind=null;paint()}
 function positionPopup(){if(!popup)return;const r=popupAnchor.getBoundingClientRect(),width=Math.min(420,innerWidth-24);popup.style.width=width+'px';const height=Math.min(popup.scrollHeight,innerHeight-24),left=Math.max(12,Math.min(innerWidth-width-12,r.right-width)),top=r.bottom+height+10<innerHeight?r.bottom+6:Math.max(12,Math.min(innerHeight-height-12,r.top-height-6));Object.assign(popup.style,{left:left+'px',top:top+'px'})}
 function openPopup(kind,anchor){if(popupKind===kind){closePopup({focus:true});return}closePopup();popupKind=kind;popupAnchor=anchor;popup=document.createElement('section');popup.className='ce-popup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label',kind==='adjust'?'Adjust experiment':'Experiment breakdown');popup.innerHTML=`<header><b>${kind==='adjust'?'Adjust experiment':'Breakdown'}</b><button type="button" data-ce="popup-close" aria-label="Close ${kind==='adjust'?'adjustments':'breakdown'}">Close</button></header><div class="ce-popup-content"></div>`;const box=kind==='adjust'?parameterBox:breakdownBox;box.hidden=false;popup.querySelector('.ce-popup-content').append(box);document.body.append(popup);popup.addEventListener('input',input);popup.addEventListener('change',input);popup.addEventListener('click',click);anchor.setAttribute('aria-expanded','true');if(kind==='breakdown')breakdown=true;math(popup);positionPopup();popup.querySelector('button').focus();paint()}
 function paint(){
  if(!alive)return;const r=canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height),dpr=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);const state=model.evaluate(t,params);
  const tooSmall=h<145;expand.hidden=!tooSmall;
  if(!tooSmall)model.draw(ctx,{width:w,height:h,t,params,view,breakdown,state});
  readout.textContent=model.describe(state,params);readout.title=readout.textContent;canvas.setAttribute('aria-description',readout.textContent);
  time.max=duration();time.value=t;time.step=duration()<.1?'0.000001':'0.001';clock.textContent=duration()<.1?`${(t*1000).toFixed(2)} ms`:`${t.toFixed(2)} s`;
  clock.title=`Physical simulation time; playback ${(spec.playback_rate||model.playbackRate?.(params)||1).toPrecision(3)}× real time`;
  play.setAttribute('aria-label',playing?'Pause':'Play');play.innerHTML=controlIcon(playing?'pause':'play')+`<span>${playing?'Pause':'Play'}</span>`;
  root.querySelectorAll('[data-ce=view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  root.querySelector('[data-ce=breakdown]')?.setAttribute('aria-pressed',String(breakdown));
 }
 function stop(){playing=false;last=null;if(frame!==null)cancelAnimationFrame(frame);frame=null}
 function tick(now){if(!alive||!playing)return;if(document.hidden||!host.isConnected){stop();paint();return}if(last!==null)t=Math.min(duration(),t+Math.min(.08,(now-last)/1000)*(spec.playback_rate||model.playbackRate?.(params)||1));last=now;if(t>=duration())stop();paint();if(playing)frame=requestAnimationFrame(tick)}
 function input(e){const el=e.target;if(el.dataset.param){const d=spec.parameters.find(p=>p.key===el.dataset.param),value=Number(el.value);if(d.choices?.length&&!d.choices.some(c=>Number(c.value)===value))return;params[d.key]=Math.max(d.min,Math.min(d.max,value));stop();t=0;parameterBox.querySelector(`[data-param-value="${d.key}"]`).textContent=labelValue(d,params[d.key]);paint()}else if(el.dataset.ce==='time'){stop();t=Number(el.value);paint()}}
 function click(e){const target=e.target.closest('[data-ce]'),action=target?.dataset.ce;if(action==='popup-close'){closePopup({focus:true});return}if(action==='breakdown'){if(breakdown){breakdown=false;closePopup();paint()}else openPopup(action,target);return}if(action==='adjust'){openPopup(action,target);return}if(action==='view'){view=target.dataset.view;paint()}if(action==='play'){if(playing)stop();else{if(t>=duration())t=0;playing=true;last=null;frame=requestAnimationFrame(tick)}paint()}if(action==='reset'){closePopup();stop();t=0;view=spec.views?.[0]?.id||'setup';breakdown=false;for(const p of spec.parameters||[]){params[p.key]=p.value;parameterBox.querySelector(`[data-param="${p.key}"]`).value=p.value;parameterBox.querySelector(`[data-param-value="${p.key}"]`).textContent=labelValue(p,p.value)}paint()}}
 function restore(saved){
  if(saved?.kind!==spec.kind||saved.problem!==spec.id||saved.source_revision!==spec.source.content_sha256)return;
  stop();for(const p of spec.parameters||[]){const v=saved.params?.[p.key];if(typeof v!=='number'||!Number.isFinite(v)||v<p.min||v>p.max||p.choices?.length&&!p.choices.some(c=>Number(c.value)===v)||p.step&&Math.abs((v-p.min)/p.step-Math.round((v-p.min)/p.step))>1e-6)continue;params[p.key]=v;parameterBox.querySelector(`[data-param="${p.key}"]`).value=v;parameterBox.querySelector(`[data-param-value="${p.key}"]`).textContent=labelValue(p,v)}
  if(spec.views?.some(v=>v.id===saved.view))view=saved.view;t=Math.max(0,Math.min(duration(),Number(saved.t)||0));paint();
 }
 root.addEventListener('input',input);root.addEventListener('change',input);root.addEventListener('click',click);
 const scroll=host.closest('.tv-scroll');
 const observer=new ResizeObserver(paint);observer.observe(canvas);const visibility=()=>{if(document.hidden){stop();closePopup();paint()}},outside=e=>{if(popup&&!popup.contains(e.target)&&!root.querySelector('.ce-options').contains(e.target))closePopup()},key=e=>{if(popup&&e.key==='Escape'){e.preventDefault();e.stopPropagation();closePopup({focus:true})}},resize=()=>{const aside=host.closest('.lr-visual');if(aside){aside.dataset.visualMin=innerWidth<=800?'380':'480';const compact=innerWidth<=800&&!aside.classList.contains('lr-expanded');aside.style.minHeight=compact?'0':'';aside.style.maxHeight=compact&&scroll?Math.max(240,scroll.clientHeight-32)+'px':'';aside._visualSize?.()}paint();positionPopup()};const layoutObserver=new ResizeObserver(resize);if(scroll)layoutObserver.observe(scroll);document.addEventListener('visibilitychange',visibility);document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);addEventListener('resize',resize);resize();
 return {get state(){return {kind:spec.kind,problem:spec.id,source_revision:spec.source.content_sha256,t,playing,view,breakdown,params:{...params}}},resize,restore,pause(){stop();closePopup();paint()},setTime(v){stop();t=Math.max(0,Math.min(duration(),Number(v)||0));paint()},setView(v){if(spec.views?.some(s=>s.id===v)){view=v;paint()}},destroy(){stop();closePopup();alive=false;observer.disconnect();layoutObserver.disconnect();const aside=host.closest('.lr-visual');if(aside){aside.style.minHeight='';aside.style.maxHeight=''}document.removeEventListener('visibilitychange',visibility);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);removeEventListener('resize',resize);root.remove();model.destroy?.()}};
}
