// Web Audio beep + vibration feedback for scan accept/reject.
// Matches the prototype exactly: single 1180Hz blip on accept,
// two 320Hz blips 140ms apart on reject. Guarded in try/catch —
// some Android WebViews restrict audio until a user gesture has fired.
let ac = null;

function play(ctx, delaySec, freq) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.05, ctx.currentTime + delaySec);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delaySec + 0.09);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(ctx.currentTime + delaySec);
  o.stop(ctx.currentTime + delaySec + 0.1);
}

export function feedback(bad, enabled = true) {
  if (!enabled) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ac = ac || new AC();
      if (bad) {
        play(ac, 0, 320);
        play(ac, 0.14, 320);
      } else {
        play(ac, 0, 1180);
      }
    }
  } catch {
    /* ignore */
  }
  try {
    if (navigator.vibrate) navigator.vibrate(bad ? [40, 60, 40] : 30);
  } catch {
    /* ignore */
  }
}
