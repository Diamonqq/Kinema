// Shared number formatting for experiment labels, readouts and equations:
// fixed significant figures, a typeset minus and powers of ten instead of e-notation.
const SUPERSCRIPT='⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript=n=>(n<0?'⁻':'')+String(Math.abs(n)).replace(/\d/g,d=>SUPERSCRIPT[d]);
function split(value,sig,lo,hi){
 const a=Math.abs(value);if(a<1e-12)return {zero:true};
 if(a<lo||a>=hi){const [m,e]=value.toExponential(sig-1).split('e');return {mantissa:m,power:Number(e)};}
 const digits=Math.max(0,sig-1-Math.floor(Math.log10(a)));return {fixed:value.toFixed(digits)};
}
// num(-1.108e-4) → "−1.11×10⁻⁴", num(9.81) → "9.81", num(1) → "1.00", num(6.67e10) → "6.67×10¹⁰".
export function num(value,sig=3,{lo=1e-3,hi=1e5}={}){
 if(!Number.isFinite(value))return '—';
 const p=split(value,sig,lo,hi);
 const text=p.zero?'0':p.fixed!==undefined?p.fixed:p.mantissa+'×10'+superscript(p.power);
 return text.replace(/^-/,'−');
}
// texNum(-1.108e-4) → "-1.11\times10^{-4}" for KaTeX, which typesets the minus itself.
export function texNum(value,sig=3,{lo=1e-3,hi=1e5}={}){
 if(!Number.isFinite(value))return '\\text{—}';
 const p=split(value,sig,lo,hi);
 return p.zero?'0':p.fixed!==undefined?p.fixed:p.mantissa+'\\times10^{'+p.power+'}';
}
// Value and unit for a label: withUnit(-0.631,'N') → "−0.631 N".
export const withUnit=(value,unit,sig=3)=>num(value,sig)+(unit?' '+unit:'');
// Axis ticks at round values (1, 2 or 5 × 10ⁿ) covering [lo, hi]; zero is a tick whenever it lies in range.
// niceTicks(-0.37, 1.9) → {step:0.5, ticks:[0, 0.5, 1, 1.5]}.
export function niceTicks(lo,hi,count=5){
 if(!Number.isFinite(lo)||!Number.isFinite(hi))return {step:0,ticks:[]};
 if(hi<lo)[lo,hi]=[hi,lo];
 const span=hi-lo||Math.abs(hi)||1,rough=span/Math.max(1,count),power=10**Math.floor(Math.log10(rough)),unit=rough/power;
 const step=(unit<1.5?1:unit<3.5?2:unit<7.5?5:10)*power,ticks=[];
 for(let k=Math.ceil(lo/step-1e-9);k*step<=hi+step*1e-9;k++)ticks.push(Math.abs(k)<1e-12?0:+(k*step).toPrecision(12));
 return {step,ticks};
}
// Tick text with only the digits the step needs: tickLabel(1.5, 0.5) → "1.5", tickLabel(-2, 2) → "−2".
export function tickLabel(value,step){
 if(Math.abs(value)<Math.abs(step||1)*1e-9)return '0';
 const sig=Math.max(1,Math.floor(Math.log10(Math.abs(value)))-Math.floor(Math.log10(Math.abs(step||value)))+1);
 return num(value,Math.min(sig,6));
}
