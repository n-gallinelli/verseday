// Shared audio cues. Web Audio so we don't ship sample files; keeps
// the bundle small and lets us tune the sounds in one place.

interface ToneOpts {
  freq: number;
  startOffset: number;
  peakGain: number;
  decaySec: number;
}

function addTone(ctx: AudioContext, baseTime: number, opts: ToneOpts) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = opts.freq;
  const start = baseTime + opts.startOffset;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(opts.peakGain, start + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.001, start + opts.decaySec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + opts.decaySec);
}

/** Break-time chime — descending G-major arpeggio (G5 → D5 → G4) with
 *  octave overtones for a bell-like ring. Descending shape signals
 *  settling / exhale rather than alert. ~2.7s total. */
export function playBreakChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const notes: { freq: number; offset: number }[] = [
      { freq: 783.99, offset: 0.0 },   // G5
      { freq: 587.33, offset: 0.35 },  // D5
      { freq: 391.99, offset: 0.7 },   // G4
    ];

    for (const n of notes) {
      // Fundamental — main body of each note. Both FocusMode and
      // FocusPip fire this in parallel (separate AudioContexts), so
      // peak gain is intentionally low to avoid stacking into a loud
      // chime. Tweak here, not at the call sites.
      addTone(ctx, now, {
        freq: n.freq,
        startOffset: n.offset,
        peakGain: 0.08,
        decaySec: 2.0,
      });
      // Octave-up overtone — soft bell-like ring without a sample.
      addTone(ctx, now, {
        freq: n.freq * 2,
        startOffset: n.offset,
        peakGain: 0.022,
        decaySec: 1.6,
      });
    }

    setTimeout(() => ctx.close(), 3500);
  } catch {
    // Silent fallback — audio may not be available (e.g. autoplay
    // restrictions on a fresh window before any user gesture).
  }
}
