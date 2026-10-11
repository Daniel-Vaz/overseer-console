/**
 * The console's own sounds: relay clicks and tube beeps, synthesised on the
 * spot. No recordings, nothing from the games.
 */

let context: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    context ??= new AudioContext();
    // Browsers keep a new context suspended until the user has interacted.
    if (context.state === 'suspended') void context.resume();
    return context.state === 'running' ? context : null;
  } catch {
    return null;
  }
}

function tone(frequency: number, duration: number, type: OscillatorType, volume: number, slideTo?: number): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

/** A short burst of filtered noise: a key or relay click. */
function click(volume: number, cutoff: number): void {
  const ctx = audio();
  if (!ctx) return;
  const length = Math.floor(ctx.sampleRate * 0.03);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = cutoff;
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
}

/**
 * Releases the audio device. Called before handing the tab to a game, so the
 * console's output stream is gone before the engine opens its own.
 */
export async function closeAudio(): Promise<void> {
  const closing = context;
  context = null;
  if (!closing || closing.state === 'closed') return;
  await Promise.race([closing.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 400))]);
}

export const sfx = {
  /** Moving the selection. */
  move: () => click(0.22, 2600),
  /** A character appearing on the tube. */
  type: () => click(0.07, 3800),
  /** Opening something. */
  select: () => {
    click(0.3, 1800);
    tone(880, 0.07, 'square', 0.035);
  },
  back: () => tone(520, 0.07, 'square', 0.03, 380),
  /** Not available. */
  deny: () => tone(150, 0.16, 'sawtooth', 0.05),
  done: () => {
    tone(660, 0.09, 'square', 0.035);
    window.setTimeout(() => tone(990, 0.14, 'square', 0.035), 90);
  },
  /** A rocker switch. */
  switch: () => click(0.4, 900),
};
