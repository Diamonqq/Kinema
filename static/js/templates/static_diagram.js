/* Fallback: a labelled SVG supplied by the model (sanitized server-side); nothing is simulated. */
(function () {
  const K = window.Kinema;
  K.template('static_diagram', {
    svg: true,
    duration() { return 0; },
    stateAt() { return { t: 0, q: [], qd: [], flags: {} }; },
    bounds() { return { xmin: 0, xmax: 1, ymin: 0, ymax: 1 }; },
    render(g) { g.text('static diagram — not simulated', 0.5, 0.5, { color: '#6C6D75' }); },
    fbd() { return []; }, vectors() { return []; }, quantities() { return []; }, energy() { return []; }, answers() { return {}; },
  });
})();
