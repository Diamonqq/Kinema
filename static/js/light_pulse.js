import { controlIcon } from './icons.js';
// Exact analytic ground-frame examples from authored lesson11.2. c=1, L=1 units.
export function pulseState(beta,t,opposite=false){
 const b=Math.max(0,Math.min(.8,Number(beta)||0)),time=Math.max(0,Number(t)||0);
 return {beta:b,t:time,light:time,receiver:1+b*time,left:-time,meeting:1/(1-b),gap:opposite?2*time:Math.max(0,1-(1-b)*time)};
}
// A compact viewBox keeps 16-unit labels above 12 screen pixels in the 276px phone pane.
// Labels have separate lanes; leaders retain exact positions even at emission/meeting.
export function pulseProjection(beta,t,opposite=false){
 const s=pulseState(beta,t,opposite),max=opposite?2:Math.max(2,s.meeting+.2);
 const X=x=>(opposite?160:38)+x*(opposite?144:244)/max;
 const label=(id,x,y,text,color,width)=>({id,point:X(x),x:Math.max(12+width/2,Math.min(308-width/2,X(x))),y,text,color,width});
 return {width:320,height:190,fontSize:16,axis:100,origin:X(0),
  light:X(s.light),receiver:X(s.receiver),left:X(s.left),
  labels:opposite?[label('left',s.left,58,'Left: c','#e9b67d',70),label('right',s.light,158,'Right: c','#8dc7ff',80)]:
   [label('light',s.light,58,'Light: ct','#8dc7ff',84),label('receiver',s.receiver,158,'Receiver: L + vt','#83cbb1',136)]};
}
export function pulseSVG(beta,t,opposite=false){
 const p=pulseProjection(beta,t,opposite),y=p.axis;
 const labels=p.labels.map(l=>`<path d="M${l.x} ${l.y<y?l.y+8:l.y-20}L${l.point} ${l.y<y?y-17:y+18}" stroke="${l.color}" opacity=".65" fill="none"/><text data-pulse-label="${l.id}" x="${l.x}" y="${l.y}" text-anchor="middle" fill="${l.color}">${l.text}</text>`).join('');
 const dot=(x,color)=>`<circle cx="${x}" cy="${y}" r="6" fill="${color}"/>`;
 return `<svg viewBox="0 0 320 190" role="img" aria-label="${opposite?'Two light pulses move in opposite directions at c':'A light pulse at c catches a receiver initially L ahead moving at v'}"><desc>${opposite?'Each pulse: c; gap grows at 2c':'Meeting when ct = L + vt'}</desc><rect width="320" height="190" fill="#1b1b1b" rx="12"/><g font-family="system-ui,sans-serif" font-size="16" fill="#dce5f1"><text x="16" y="25">Ground frame</text><path d="M16 ${y}H304" stroke="#667586" stroke-width="1.5"/><path d="M${p.origin} ${y-7}v14" stroke="#9cabbd"/><text x="${p.origin}" y="${y+28}" text-anchor="middle">0</text>${opposite?dot(p.left,'#e9b67d'):`<rect x="${p.receiver-9}" y="${y-15}" width="18" height="30" rx="4" fill="#83cbb1"/>`}${dot(p.light,'#8dc7ff')}${labels}</g></svg>`;
}
export function mountLightPulse(host,{saved,onState}={}){
 let beta=pulseState(saved?.beta??.4,0).beta,t=Math.min(Math.max(0,Number(saved?.t)||0),saved?.opposite?1.8:1/(1-beta)),opposite=!!saved?.opposite,playing=false,raf=null,last=null,alive=true;
 host.innerHTML=`<div class="lpulse"><div class="lpulse-picture"></div><p class="lpulse-caption"></p><div class="lpulse-controls"><label>Experiment<select data-pulse-mode><option value="receiver">Moving receiver</option><option value="opposite">Opposite flashes</option></select></label><label data-speed-row>Receiver speed v/c<input data-pulse-speed type="range" min="0" max="0.8" step="0.05"></label><label>Ground time<input data-pulse-time type="range" min="0" step="0.01"></label><output aria-live="off"></output><div><button data-pulse-play>Play</button><button data-pulse-reset>${controlIcon('reset')} Reset</button></div></div><p class="lpulse-note">Compare positions at the same ground-frame time. A closing-gap rate is not a measurement in the receiver’s frame; a light pulse has no rest frame.</p></div>`;
 const q=s=>host.querySelector(s),state=()=>({beta,t,opposite}),duration=()=>opposite?1.8:1/(1-beta);
 const stop=()=>{playing=false;if(raf!==null)cancelAnimationFrame(raf);raf=null;last=null};
 const paint=()=>{if(!alive)return;q('.lpulse-picture').innerHTML=pulseSVG(beta,t,opposite);q('.lpulse-caption').textContent=opposite?'Each pulse moves at c; their gap grows at 2c. Units: c = 1.':'Meeting: ct = L + vt. Units: c = 1, L = 1.';q('[data-pulse-mode]').value=opposite?'opposite':'receiver';q('[data-speed-row]').hidden=opposite;q('[data-pulse-speed]').value=beta;q('[data-pulse-time]').max=duration();q('[data-pulse-time]').value=t;q('output').textContent=opposite?`t = ${t.toFixed(2)} · separation = ${(2*t).toFixed(2)}`:`v = ${beta.toFixed(2)}c · t = ${t.toFixed(2)} · meeting t = ${duration().toFixed(2)}`;q('[data-pulse-play]').textContent=playing?'Pause':'Play';onState?.(state())};
 const tick=now=>{if(!alive||!playing)return;const dt=last===null?0:Math.min(.06,(now-last)/1000);last=now;t=Math.min(duration(),t+dt*.55);if(t>=duration())stop();paint();if(playing)raf=requestAnimationFrame(tick)};
 q('[data-pulse-play]').onclick=()=>{if(playing)stop();else{if(t>=duration())t=0;playing=true;raf=requestAnimationFrame(tick)}paint()};
 q('[data-pulse-reset]').onclick=()=>{stop();t=0;paint()};
 q('[data-pulse-speed]').oninput=e=>{stop();beta=Number(e.target.value);t=0;paint()};
 q('[data-pulse-time]').oninput=e=>{stop();t=Number(e.target.value);paint()};
 q('[data-pulse-mode]').onchange=e=>{stop();opposite=e.target.value==='opposite';t=0;paint()};
 paint();return {get state(){return state()},pause(){stop();paint()},setExample(index){stop();opposite=index===1;t=0;paint()},resize(){},destroy(){stop();alive=false;host.replaceChildren()}};
}
