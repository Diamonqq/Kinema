import { controlIcon } from './icons.js';
﻿import {esc,mdlite,texExpr} from './md.js';

export const lessonRows=sheet=>(sheet?.sections||[]).flatMap(s=>[s,...(s.subsections||[])]);
export function readerParts(section,view={}) {
 const lesson=section?.lesson;
 if(!lesson)return `<div class="mdb">${mdlite(section?.notes||section?.summary||'This reading is unavailable.')}</div>`;
 if(view.tab==='examples'){
  const examples=lesson.examples||[],index=Math.max(0,Math.min(examples.length-1,Number(view.example)||0)),e=examples[index];
  if(!e)return '<p>No worked example is prepared for this section.</p>';
  return `${examples.length>1?`<nav class="lr-example-nav" aria-label="Choose worked example"><button data-reading="example" data-index="${index-1}" ${index===0?'disabled':''} aria-label="Previous example">${controlIcon('left')}</button><span>Example ${index+1} of ${examples.length}</span><button data-reading="example" data-index="${index+1}" ${index===examples.length-1?'disabled':''} aria-label="Next example">${controlIcon('right')}</button></nav>`:''}<article class="lr-example"><h2>${esc(e.title)}</h2><div class="mdb">${mdlite(e.setup_md)}</div><ol class="lr-steps">${(e.steps||[]).map((s,i)=>`<li><button type="button" class="lr-step-number" data-reference-kind="example" data-reference-step="${i}" aria-label="Ask about step ${i+1}" aria-pressed="false" title="Attach step ${i+1} to your question">${i+1}</button><div>${s.math?texExpr(s.math,true):''}<div class="mdb">${mdlite(s.why)}</div></div></li>`).join('')}</ol>${e.answer_md?`<section><h3>Result</h3><div class="mdb">${mdlite(e.answer_md)}</div></section>`:''}${e.check_md?`<section><h3>Check the result</h3><div class="mdb">${mdlite(e.check_md)}</div></section>`:''}</article>`;
 }
 if(view.tab==='practice'){
  const p=lesson.practice;if(!p?.question_md)return '<p>No independent practice is prepared here.</p>';
  const n=Math.max(0,Math.min(p.hints?.length||0,Number(view.hints)||0));
  return `<article class="lr-practice"><div class="mdb">${mdlite(p.question_md)}</div>${(p.hints||[]).slice(0,n).map((s,i)=>`<section><h3>Hint ${i+1}</h3><div class="mdb">${mdlite(s)}</div></section>`).join('')}${view.answer?`<section><h3>Solution</h3><div class="mdb">${mdlite(p.answer_md||'')}</div></section>`:''}<div class="lr-practice-actions">${!view.answer&&n<(p.hints?.length||0)?`<button data-reading="practice-hint">${n?'Next hint':'Hint'}</button>`:''}${p.answer_md&&!view.answer?'<button data-reading="practice-answer">Show solution</button>':''}</div></article>`;
 }
 return `<article class="lr-explanation"><div class="lr-summary mdb">${mdlite(lesson.summary||'')}</div>${(lesson.prerequisites||[]).map(r=>`<section class="lr-basics"><h2>${esc(r.idea)}</h2><div class="mdb">${mdlite(r.refresher_md)}</div></section>`).join('')}${(lesson.parts||[]).filter(r=>r.body_md?.trim()!==lesson.summary?.trim()).map(r=>`<section><h2>${esc(r.title)}</h2><div class="mdb">${mdlite(r.body_md)}</div></section>`).join('')}</article>`;
}

export function lessonReader(section,sheet,view={}) {
 const rows=lessonRows(sheet),tab=['explanation','examples','practice'].includes(view.tab)?view.tab:'explanation';
 return `<div class="lr-lesson" data-reader-section="${esc(section.id)}"><header class="lr-heading"><span class="lr-kicker">Lesson ${esc(section.id)}</span><h1>${esc(section.title)}</h1></header><nav class="lr-tabs" aria-label="Lesson content">${[['explanation','Explanation'],['examples','Examples'],['practice','Practice']].filter(([key])=>key==='explanation'||key==='examples'&&section.lesson?.examples?.length||key==='practice'&&section.lesson?.practice?.question_md).map(([key,label])=>`<button data-reading="lesson-tab" data-tab="${key}" aria-current="${tab===key?'page':'false'}">${label}</button>`).join('')}</nav><div class="lr-panel">${readerParts(section,{...view,tab})}</div></div>`;
}

export function lessonNavigation(nav){
 if(!nav)return '';
 return `<nav class="lr-lesson-nav" aria-label="Lesson order">${['previous','next'].map(dir=>{const r=nav[dir];return `<button data-reading="lesson-move" data-direction="${dir}" ${r?'':'disabled'} title="${r?esc(r.id+' '+r.title):'End of lessons'}" aria-label="${dir==='next'?'Next':'Previous'} lesson${r?': '+esc(r.id+' '+r.title):''}">${dir==='next'?'Next '+controlIcon('right'):controlIcon('left')}</button>`;}).join('')}</nav>`;
}
