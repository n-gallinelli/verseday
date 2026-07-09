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
    // Defensive: a context can come up suspended (autoplay policy / backgrounded
    // webview) and then fail SILENTLY. resume() before scheduling. Harmless when
    // already running. Applies wherever the chime plays (engine or pip).
    void ctx.resume();
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

/** Break-END chime — ascending G-major arpeggio (G4 → D5 → G5), the
 *  timbral inverse of playBreakChime's descending shape. Rising shape
 *  signals "back to work / lift" so the end of a break is unmistakably
 *  distinct from its start. Same low-gain anti-stack design (both windows
 *  fire it in parallel) and octave overtones. ~2.7s total. */
export function playBreakEndChime() {
  try {
    const ctx = new AudioContext();
    // Defensive: a context can come up suspended (autoplay policy / backgrounded
    // webview) and then fail SILENTLY. resume() before scheduling. Harmless when
    // already running. Applies wherever the chime plays (engine or pip).
    void ctx.resume();
    const now = ctx.currentTime;

    const notes: { freq: number; offset: number }[] = [
      { freq: 391.99, offset: 0.0 },   // G4
      { freq: 587.33, offset: 0.35 },  // D5
      { freq: 783.99, offset: 0.7 },   // G5
    ];

    for (const n of notes) {
      // Fundamental — see playBreakChime: peak gain kept low because
      // FocusMode + FocusPip fire this in parallel (separate contexts).
      addTone(ctx, now, {
        freq: n.freq,
        startOffset: n.offset,
        peakGain: 0.08,
        decaySec: 2.0,
      });
      // Octave-up overtone — soft bell ring.
      addTone(ctx, now, {
        freq: n.freq * 2,
        startOffset: n.offset,
        peakGain: 0.022,
        decaySec: 1.6,
      });
    }

    setTimeout(() => ctx.close(), 3500);
  } catch {
    // Silent fallback — see playBreakChime.
  }
}

/** Meeting chime — a doorbell "ding-dong ding-dong": a descending perfect
 *  fourth (C6 → G5) knocked out twice. Deliberately NOT the G-major break
 *  arpeggios — those signal "settle" / "back to work"; this is a two-note
 *  paired knock that reads as "someone's here / meeting now," so it's
 *  unmistakable against the break cues. Shorter, brighter decays (knock, not
 *  ring). Same low-gain anti-stack design + octave overtones. ~1.6s total. */
export function playMeetingChime() {
  try {
    const ctx = new AudioContext();
    // Defensive: a context can come up suspended (autoplay policy / backgrounded
    // webview) and then fail SILENTLY. resume() before scheduling. Harmless when
    // already running.
    void ctx.resume();
    const now = ctx.currentTime;

    // Two "ding-dong" knocks: C6 → G5, repeated after a short gap.
    const notes: { freq: number; offset: number }[] = [
      { freq: 1046.5, offset: 0.0 },   // C6  — ding
      { freq: 783.99, offset: 0.22 },  // G5  — dong
      { freq: 1046.5, offset: 0.6 },   // C6  — ding
      { freq: 783.99, offset: 0.82 },  // G5  — dong
    ];

    for (const n of notes) {
      // Fundamental — low peak gain because FocusPip (the confirmed-alive
      // speaker) plays it; kept consistent with the break chimes' anti-stack.
      addTone(ctx, now, {
        freq: n.freq,
        startOffset: n.offset,
        peakGain: 0.08,
        decaySec: 0.55,
      });
      // Octave-up overtone — soft bell knock.
      addTone(ctx, now, {
        freq: n.freq * 2,
        startOffset: n.offset,
        peakGain: 0.02,
        decaySec: 0.45,
      });
    }

    setTimeout(() => ctx.close(), 2200);
  } catch {
    // Silent fallback — see playBreakChime.
  }
}
