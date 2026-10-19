/* Small, analytic drawings for reviewed lesson steps. No generated geometry. */
const blue='#8cbcff', mint='#72d6bb', amber='#efb67a';
const arrow=(x,y,u,v,color,label,dx=8,dy=-8)=>`<path d="M${x} ${y}L${u} ${v}" stroke="${color}" stroke-width="3" fill="none" marker-end="url(#tv-${color.slice(1)})"/><text x="${u+dx}" y="${v+dy}" fill="${color}" font-size="18">${label}</text>`;
const defs=()=>`<defs>${[blue,mint,amber].map(c=>`<marker id="tv-${c.slice(1)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${c}"/></marker>`).join('')}</defs>`;
export class TeachingVisual {
  constructor(host) { this.host=host; this.states=new Map(); }
  reset() { this.states.clear(); this.view=null; this.host.replaceChildren(); }
  set(view) {
    this.view=view;
    if (!view || view.kind==='native') return;
    if (!this.states.has(view.step)) this.states.set(view.step,{step:view.step,angle:view.mode==='diagonal'?Math.atan(.5)*180/Math.PI:['symmetry','plate'].includes(view.mode)?0:35,square:false,change:.2});
    this.state=this.states.get(view.step);
    this.host.innerHTML=`<div class="teaching-canvas"></div><div class="teaching-readout" aria-live="polite"></div><div class="teaching-controls"></div><p class="teaching-note"></p>`;
    const controls=this.host.querySelector('.teaching-controls');
    if(view.kind==='rectangle') {
      controls.innerHTML='<label class="teaching-slider">Spin direction <output></output><input type="range" min="0" max="90" step="0.1" aria-label="Spin direction"></label><div class="teaching-buttons"><button data-angle="x">Along x</button><button data-angle="diagonal">Along diagonal</button><button data-angle="y">Along y</button></div><label class="teaching-square"><input type="checkbox"> Make it a square</label>';
      const range=controls.querySelector('[type=range]'), check=controls.querySelector('[type=checkbox]');
      range.value=this.state.angle; check.checked=this.state.square;
      range.oninput=()=>{this.state.angle=+range.value;this.draw();};
      check.onchange=()=>{this.state.square=check.checked;this.draw();};
      controls.querySelectorAll('[data-angle]').forEach(b=>b.onclick=()=>{this.state.angle=b.dataset.angle==='x'?0:b.dataset.angle==='y'?90:Math.atan(this.state.square?1:.5)*180/Math.PI;range.value=this.state.angle;this.draw();});
      this.host.querySelector('.teaching-note').textContent='Illustrative shape · directions about the centre · arrows use separate scales';
    } else {
      controls.innerHTML='<label class="teaching-slider">Small change <output></output><input type="range" min="0" max="0.5" step="0.01" aria-label="Small change in angular momentum"></label>';
      const range=controls.querySelector('input');range.value=this.state.change;range.oninput=()=>{this.state.change=+range.value;this.draw();};
      this.host.querySelector('.teaching-note').textContent=view.mode==='rule'?'A short interval: ΔL = τ Δt. Schematic arrow lengths.':'Fast-spinning wheel approximation · short interval · schematic arrows';
    }
    this.draw();
  }
  snapshot() { return this.view && this.view.kind!=='native' ? {...this.state} : null; }
  draw() {
    const v=this.view,s=this.state,canvas=this.host.querySelector('.teaching-canvas');
    let body='',readout='';
    if(v.kind==='rectangle') {
      const w=220,h=s.square?220:110,cx=180,cy=184,theta=s.angle*Math.PI/180;
      const la=Math.atan2((s.square?1:4)*Math.sin(theta),Math.cos(theta));
      body=`<rect x="${cx-w/2}" y="${cy-h/2}" width="${w}" height="${h}" rx="3" fill="${v.mode==='plate'?'#273341':'#1e252d'}" stroke="#687482" stroke-width="1.5"/>
      <path d="M35 ${cy}H330M${cx} 45V320" stroke="#566372" stroke-dasharray="3 5"/><text x="334" y="${cy+22}">x</text><text x="${cx-18}" y="43">y</text>
      <text x="${cx-14}" y="${cy+h/2+26}" font-size="13">a = ${s.square?'b':'2b'}</text><text x="${cx-w/2-21}" y="${cy-12}" font-size="13">b</text>`;
      if(v.mode!=='plate') for(const x of[-1,1])for(const y of[-1,1])body+=`<circle cx="${cx+x*w/2}" cy="${cy+y*h/2}" r="7" fill="#b8c6d6"/>`;
      // Distinct lengths intentionally convey direction, not unlike physical units.
      body+=arrow(cx,cy,cx+155*Math.cos(la),cy-155*Math.sin(la),mint,'L',8,-5);
      body+=arrow(cx,cy,cx+118*Math.cos(theta),cy-118*Math.sin(theta),blue,'ω',9,-8);
      body+=`<circle cx="${cx}" cy="${cy}" r="3" fill="#d4dce7"/>`;
      const parallel=Math.abs(la-theta)<1e-6;
      readout=`<span style="color:${blue}">ω ${s.angle.toFixed(1)}°</span><span style="color:${mint}">L ${(la*180/Math.PI).toFixed(1)}°</span><small>${parallel?'Same direction — a principal axis':`Different directions · Iᵧ = ${s.square?'Iₓ':'4Iₓ'}`}</small>`;
      this.host.querySelector('output').textContent=`${s.angle.toFixed(1)}°`;
    } else {
      const cx=92,cy=215,d=145*s.change;
      if(v.mode==='steer') {
        body=arrow(cx,cy,cx,cy-145,blue,'L',-22,-8)+arrow(cx,cy-145,cx+d,cy-145,amber,'ΔL',8,-12)+arrow(cx,cy,cx+d,cy-145,mint,'',8,22)+`<text x="${cx+d+10}" y="${cy-80}" fill="${mint}" font-size="16">new L</text>`;
        body+='<text x="240" y="290" font-size="13">Front (+x) →</text><text x="58" y="38" font-size="13">Bike left (+y) ↑</text><text x="205" y="325" font-size="13">View from above</text>';
      } else {
        const sign=v.mode==='lean'?1:-1;
        body=arrow(cx,cy,cx+145,cy,blue,'L',8,sign>0?-8:22)+arrow(cx+145,cy,cx+145,cy+sign*d,amber,'ΔL',10,sign>0?22:-8)+arrow(cx,cy,cx+145,cy+sign*d,mint,'')+`<text x="${cx+46}" y="${cy+sign*(d+24)}" fill="${mint}" font-size="16">new L</text>`;
        if(v.mode==='lean')body+='<text x="230" y="324" font-size="13">Bike left (+y) →</text><text x="38" y="60" font-size="13">Up (+z) ↑</text><text x="150" y="38" font-size="13">Looking from the front</text>';
      }
      readout='<span style="color:'+blue+'">L now</span><span style="color:'+amber+'">Add τ Δt</span><small style="color:'+mint+'">The diagonal is the new L</small>';
      this.host.querySelector('output').textContent=`${Math.round(s.change*100)}% of |L|`;
    }
    canvas.innerHTML=`<svg viewBox="0 0 400 360" role="img" aria-label="${v.title}" xmlns="http://www.w3.org/2000/svg" fill="#a8b5c4" font-family="system-ui,sans-serif">${defs()}${body}</svg>`;
    this.host.querySelector('.teaching-readout').innerHTML=readout;
  }
}
