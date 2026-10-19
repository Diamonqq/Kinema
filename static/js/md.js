/* Shared text helpers: HTML escaping, a small Markdown subset, KaTeX rendering. */
export const esc = x => String(x ?? '').normalize('NFC').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* The serif reading font draws unit-vector hats badly (ẑ, r̂); set those letters in the sans font, which draws them
   well. Only outside $…$ math, which KaTeX renders itself. */
const HAT = /([A-Za-z\u03B1-\u03C9][\u0300-\u036F]+|[\u1E90\u1E91\u0108\u0109\u011C\u011D\u0124\u0125\u0134\u0135\u015C\u015D\u0174\u0175\u0176\u0177])/g;
export function hats(html) {
  return String(html).split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/).map((part, i) => i % 2 ? part : part.replace(HAT, '<span class="vh">$1</span>')).join('');
}
export const txt = x => hats(esc(x));
export const KATEX = { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }], throwOnError: false };

/* **bold**, `code`, bullet and numbered lists, paragraphs; LaTeX between $ signs is left for KaTeX */
export function mdlite(src) {
  let t = esc(src);
  // An equation must stay in one text node for KaTeX's auto-renderer.
  let marker = '\uE000MATH';
  while (t.includes(marker)) marker += 'X';
  const equations = [];
  t = t.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, value => {
    const token = marker + equations.length + '\uE001'; equations.push(value); return token;
  });
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/((?:^[-*]\s.+\n?)+)/gm, m => '<ul>' + m.trim().split(/\n/).map(l => '<li>' + l.replace(/^[-*]\s+/, '') + '</li>').join('') + '</ul>');
  t = t.replace(/((?:^\d+[.)]\s.+\n?)+)/gm, m => { const n = parseInt(m.trim(), 10); return '<ol' + (n > 1 ? ` start="${n}"` : '') + '>' + m.trim().split(/\n/).map(l => '<li>' + l.replace(/^\d+[.)]\s+/, '') + '</li>').join('') + '</ol>'; });   // a list continued after a split keeps its numbers
  let html = hats(t.split(/\n{2,}/).map(p => /^<(ul|ol)/.test(p) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>').join(''));
  equations.forEach((value,index) => { html = html.replace(marker + index + '\uE001',() => value); });
  return html;
}
export function math(el) { if (el && window.renderMathInElement) { try { window.renderMathInElement(el, KATEX); } catch (e) { /* leave the source visible */ } } }
/* a LaTeX expression (no delimiters) as display or inline math; plain prose stays prose */
export function texExpr(s, display) {
  const v = String(s ?? '').trim().replace(/^\$+|\$+$/g, '');
  if (!v) return '';
  const looksTex = /[\\_^=+*/{}]/.test(v) || !/\s/.test(v);
  return looksTex ? (display ? '$$' + esc(v) + '$$' : '$' + esc(v) + '$') : esc(v);
}
export const fmt = (v, d) => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 0.001 || v === 0 ? v.toFixed(d ?? (Math.abs(v) >= 10 ? 2 : 3)) : v.toExponential(2);
