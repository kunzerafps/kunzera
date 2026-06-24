// Timeline & easing helpers shared by all videos
(function(){
  const clamp = (v, a=0, b=1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInCubic  = t => t * t * t;
  const easeOutBack  = (t, s=1.6) => 1 + (s+1) * Math.pow(t-1, 3) + s * Math.pow(t-1, 2);
  const seg = (t, a, b, ease=easeOutCubic) => ease(clamp((t - a) / (b - a), 0, 1));
  const fadeHold = (t, inA, inB, outA, outB) => {
    if (t < inA) return 0;
    if (t < inB) return easeOutCubic((t - inA) / (inB - inA));
    if (t < outA) return 1;
    if (t < outB) return 1 - easeInCubic((t - outA) / (outB - outA));
    return 0;
  };
  const formatARS = n => '$' + Math.round(n).toLocaleString('es-AR');

  window.TL = { clamp, lerp, easeOutCubic, easeInCubic, easeOutBack, seg, fadeHold, formatARS };

  // Auto-loop player unless Puppeteer disables it by setting window.__EXPORT_MODE = true
  window.__startLoop = function(duration, renderFn){
    window.__duration = duration;
    window.render = renderFn;
    renderFn(0);
    if (window.__EXPORT_MODE) return;
    const start = performance.now();
    function tick(){
      const t = ((performance.now() - start) / 1000) % duration;
      renderFn(t);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };
})();
