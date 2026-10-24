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
