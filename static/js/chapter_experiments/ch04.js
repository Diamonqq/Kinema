// Problem 4.1 is a nonlinear-equation counterexample, not a mechanical sketch.
export function superposition(t,p={b:1,shift:.6}){
 const b=p.b,q=p.shift,x1=b*t**4/144,x2=b*(t+q)**4/144,a1=b*t*t/12,a2=b*(t+q)**2/12;
 return {t,x1,x2,sum:x1+x2,a1,a2,lhs:(a1+a2)**2,rhs:b*(x1+x2),cross:2*a1*a2};
}
const C={ink:'#dce5f2',muted:'#8e9caf',grid:'#273244',blue:'#85baff',teal:'#85d5bd',sand:'#e8bc84'};
export function createExperiment(spec){
 if(spec.id!=='4.1')throw Error('This model is bound to Problem 4.1.');
 return {duration:2,evaluate:superposition,
  describe(s){return `t=${s.t.toFixed(2)} s; squared acceleration of sum=${s.lhs.toFixed(4)} m²/s⁴; b times position sum=${s.rhs.toFixed(4)} m²/s⁴; excess=${s.cross.toFixed(4)} m²/s⁴.`},
  draw(c,{width:w,height:h,t,params:p,view,state:s,breakdown}){
   const pos=view==='solutions',cross=view==='cross',left=45,right=w-14,top=pos?40:52,bottom=h-27;
   const f=superposition(2,p),max=Math.max(.001,pos?f.sum:cross?f.cross:f.lhs)*1.08;
   const X=q=>left+(right-left)*q/2,Y=q=>bottom-(bottom-top)*q/max;
   c.fillStyle=C.muted;c.font='11px system-ui';c.textAlign='left';c.fillText(pos?'position (m)':'equation terms (m²/s⁴)',left,13);
   c.strokeStyle=C.grid;c.lineWidth=1;
   for(let i=0;i<=2;i++){c.beginPath();c.moveTo(left,Y(max*i/2));c.lineTo(right,Y(max*i/2));c.stroke();c.fillText((max*i/2).toFixed(2),2,Y(max*i/2)+4);c.fillText(String(i),X(i)-3,bottom+16)}
   c.fillText('t (s)',right-24,bottom+16);
   const curves=pos?[['x1',C.blue],['x2',C.teal],['sum',C.sand]]:cross?[['cross',C.sand]]:[['lhs',C.sand],['rhs',C.blue]];
   for(const [key,col] of curves){c.strokeStyle=col;c.lineWidth=2;c.beginPath();for(let i=0;i<=100;i++){const z=i/50,y=superposition(z,p)[key];if(i)c.lineTo(X(z),Y(y));else c.moveTo(X(z),Y(y))}c.stroke();c.fillStyle=col;c.beginPath();c.arc(X(t),Y(s[key]),3.2,0,2*Math.PI);c.fill()}
   c.setLineDash([3,3]);c.strokeStyle=C.muted;c.beginPath();c.moveTo(X(t),top);c.lineTo(X(t),bottom);c.stroke();c.setLineDash([]);
   const labels=pos?['x₁','x₂','x₁+x₂']:cross?['cross term']:['(ẍ₁+ẍ₂)²','b(x₁+x₂)'];
   curves.forEach(([,col],i)=>{c.fillStyle=col;c.fillText(labels[i],left+(pos?i*(w-left-15)/3:0),pos?30:29+i*14)});

  }};
}
