// Web Audio beep + vibration feedback for scan accept/reject.
// Accept: three quick rising notes (C6–E6–G6). Reject: three fast low beeps
// at 440 Hz. Played loud through a compressor so they don't clip on small
// phone speakers. Guarded in try/catch — some Android WebViews restrict audio
// until a user gesture has fired.
let ac = null;

// [startSec, durationSec, freqHz]
const OK = [[0, 0.08, 1047], [0.07, 0.08, 1319], [0.14, 0.14, 1568]];
const BAD = [[0, 0.08, 440], [0.12, 0.08, 440], [0.24, 0.08, 440]];
const VOLUME = 0.4;

function play(ctx, tones) {
  const master = ctx.createGain();
  master.gain.value = VOLUME;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);
  const now = ctx.currentTime + 0.02;
  for (const [at, dur, freq] of tones) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(freq, now + at);
    g.gain.setValueAtTime(0.0001, now + at);
    g.gain.exponentialRampToValueAtTime(1, now + at + 0.005);
    g.gain.setValueAtTime(1, now + at + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
    o.connect(g);
    g.connect(master);
    o.start(now + at);
    o.stop(now + at + dur + 0.02);
  }
}

export function feedback(bad, enabled = true) {
  if (!enabled) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ac = ac || new AC();
      if (ac.state === 'suspended') ac.resume();
      play(ac, bad ? BAD : OK);
    }
  } catch {
    /* ignore */
  }
  try {
    if (navigator.vibrate) navigator.vibrate(bad ? [60, 60, 60, 60, 60] : 40);
  } catch {
    /* ignore */
  }
}
