/* Small arithmetic parser: no eval, scripts, properties or variables from the page. */
export function calculate(source, mode = 'rad', ans = 0) {
  const text = source.replaceAll('×', '*').replaceAll('÷', '/').replaceAll('π', 'pi').replaceAll('−', '-').trim();
  if (!text || text.length > 240) throw Error('Enter a calculation (up to 240 characters).');
  const tokens = []; let at = 0;
  while (at < text.length) {
    const m = /^(?:\s+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z]+|[+\-*/^()%])/.exec(text.slice(at));
    if (!m) throw Error('Use numbers, parentheses and the calculator functions.');
    if (m[0].trim()) tokens.push(m[0].toLowerCase()); at += m[0].length;
  }
  let i = 0, depth = 0;
  const angle = mode === 'deg' ? Math.PI / 180 : 1;
  const funcs = { sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp,
    sin: x => Math.sin(x * angle), cos: x => Math.cos(x * angle), tan: x => {
      if (Math.abs(Math.cos(x * angle)) < 1e-14) throw Error('Tangent is undefined at this angle.');
      return Math.tan(x * angle);
    }, asin: x => Math.asin(x) / angle, acos: x => Math.acos(x) / angle, atan: x => Math.atan(x) / angle };
  function atom() {
    if (++depth > 60) throw Error('Too many nested operations.');
    let v, t = tokens[i++];
    if (t === '+' || t === '-') v = (t === '-' ? -1 : 1) * expr(3);
    else if (t === '(') { v = expr(0); if (tokens[i++] !== ')') throw Error('Close the parentheses.'); }
    else if (t && /^(?:\d|\.)/.test(t)) v = Number(t);
    else if (t === 'pi') v = Math.PI;
    else if (t === 'e') v = Math.E;
    else if (t === 'ans') v = ans;
    else if (Object.hasOwn(funcs, t)) {
      if (tokens[i++] !== '(') throw Error('Put function arguments in parentheses.');
      const x = expr(0); if (tokens[i++] !== ')') throw Error('Close the parentheses.'); v = funcs[t](x);
    } else throw Error('Check the expression.');
    while (tokens[i] === '%') { v /= 100; i++; }
    depth--; return v;
  }
  function expr(min) {
    let v = atom();
    while (i < tokens.length) {
      const op = tokens[i], p = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 }[op];
      if (!p || p < min) break;
      i++; const right = expr(op === '^' ? p : p + 1);
      if (op === '/' && right === 0) throw Error('Cannot divide by zero.');
      v = op === '+' ? v + right : op === '-' ? v - right : op === '*' ? v * right : op === '/' ? v / right : v ** right;
    }
    return v;
  }
  const result = expr(0);
  if (i !== tokens.length) throw Error('Use × between quantities, for example 2×pi.');
  if (!Number.isFinite(result)) throw Error('No finite real result. Check the inputs.');
  return Object.is(result, -0) ? 0 : result;
}

export class Calculator {
  constructor() { this.input = ''; this.mode = 'rad'; this.history = []; this.error = ''; }
  mount(host, esc, use) {
    const keys = ['sin(', 'cos(', 'tan(', 'sqrt(', '(', ')', '^', 'pi', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', 'ans', '+'];
    host.innerHTML = `<div class="calc"><div class="calc-mode"><span>Angles</span>${['rad', 'deg'].map(m => `<button data-mode="${m}" aria-pressed="${m === this.mode}">${m.toUpperCase()}</button>`).join('')}</div>
      <label for="calc-input">Calculation</label><form><input id="calc-input" autocomplete="off" spellcheck="false" placeholder="2 × 0.5^2 × 4" value="${esc(this.input)}"><div class="calc-result" role="status">${esc(this.error || (this.history[0]?.display ?? ''))}</div>
      <div class="calc-keys">${keys.map(k => `<button type="button" data-key="${k}">${k === 'sqrt(' ? '√' : k === 'pi' ? 'π' : k.replace('(', k === '(' ? '(' : '')}</button>`).join('')}</div>
      <div class="calc-bottom"><button type="button" data-clear>Clear</button><button type="button" data-back aria-label="Backspace">⌫</button><button type="submit" class="btn p">=</button></div></form>
      <p class="tool-note">Use consistent units. Trig uses ${this.mode === 'rad' ? 'radians' : 'degrees'}. Also supports ln(), log(), abs() and 1e−3.</p>
      ${this.history.length ? `<div class="calc-history"><h3>Recent calculations</h3>${this.history.slice(0, 6).map((h, i) => `<div><button data-reuse="${i}"><span>${esc(h.expr)} <small>${h.mode.toUpperCase()}</small></span><b>${esc(h.display)}</b></button><button class="link" data-use="${i}" aria-label="Put calculation in chat">↗</button></div>`).join('')}</div>` : ''}</div>`;
    const input = host.querySelector('input');
    input.addEventListener('input', () => { this.input = input.value; });
    host.querySelector('form').onsubmit = e => {
      e.preventDefault(); this.input = input.value;
      try { const value = calculate(this.input, this.mode, this.history[0]?.value || 0); this.error = '';
        this.history.unshift({ expr: this.input, mode: this.mode, value, display: Number(value.toPrecision(12)).toString() }); this.history = this.history.slice(0, 12);
      } catch (err) { this.error = err.message; }
      this.mount(host, esc, use); host.querySelector('input').focus();
    };
    host.querySelectorAll('[data-key]').forEach(b => b.onclick = () => {
      const k = b.dataset.key, start = input.selectionStart ?? input.value.length;
      input.setRangeText(k, start, input.selectionEnd ?? start, 'end'); this.input = input.value; input.focus();
    });
    host.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { this.mode = b.dataset.mode; this.mount(host, esc, use); });
    host.querySelector('[data-clear]').onclick = () => { this.input = ''; this.error = ''; this.mount(host, esc, use); host.querySelector('input').focus(); };
    host.querySelector('[data-back]').onclick = () => { const end = input.selectionEnd, start = input.selectionStart;
      input.setRangeText('', start === end ? Math.max(0, start - 1) : start, end, 'end'); this.input = input.value; input.focus(); };
    host.querySelectorAll('[data-reuse]').forEach(b => b.onclick = () => { this.input = this.history[+b.dataset.reuse].expr; this.mount(host, esc, use); });
    host.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { const h = this.history[+b.dataset.use]; use(`${h.expr} = ${h.display} (${h.mode.toUpperCase()})`); });
  }
}
