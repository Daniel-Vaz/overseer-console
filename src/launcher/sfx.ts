/**
 * The console's own sounds: relay clicks and tube beeps, synthesised on the
 * spot. No recordings, nothing from the games.
 */
import type { Sound } from './vault/remarks';

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
 * A stretch of noise through a filter that sweeps: something wet, something
 * electric, something heavy on the move. It can be held at full strength for
 * a share of its length before it dies away.
 */
function hiss(duration: number, volume: number, type: BiquadFilterType, from: number, to: number, held = 0): void {
  const ctx = audio();
  if (!ctx) return;
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  source.buffer = buffer;
  filter.type = type;
  filter.frequency.setValueAtTime(from, now);
  filter.frequency.exponentialRampToValueAtTime(to, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.04, duration / 4));
  if (held) gain.gain.setValueAtTime(volume, now + duration * held);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);
}

const later = (ms: number, play: () => void) => window.setTimeout(play, ms);

/** What the vault behind the console asks for when something in it is meddled with. */
const room: Record<Sound, () => void> = {
  /** A radroach, flattened. */
  squash: () => {
    hiss(0.14, 0.3, 'lowpass', 2200, 180);
    tone(150, 0.1, 'sine', 0.06, 55);
  },
  bark: () => {
    tone(540, 0.07, 'sawtooth', 0.045, 360);
    later(120, () => tone(600, 0.09, 'sawtooth', 0.045, 380));
  },
  /** A mole rat that did not care for that. */
  squeak: () => {
    tone(1900, 0.06, 'sine', 0.05, 2800);
    later(70, () => tone(2100, 0.07, 'sine', 0.04, 3000));
  },
  groan: () => tone(96, 0.55, 'sawtooth', 0.035, 62),
  growl: () => tone(58, 0.45, 'sawtooth', 0.04, 44),
  /** Bones. */
  rattle: () => {
    for (let i = 0; i < 4; i++) later(i * 45, () => click(0.16, 2200 + i * 300));
  },
  /** Knuckles on a foot of steel, twice. */
  clang: () => {
    for (const wait of [0, 190]) {
      later(wait, () => {
        click(0.3, 700);
        tone(523, 0.3, 'triangle', 0.05);
        tone(1318, 0.22, 'sine', 0.025);
      });
    }
  },
  thud: () => {
    tone(82, 0.2, 'sine', 0.16, 40);
    click(0.2, 260);
  },
  zap: () => {
    hiss(0.13, 0.12, 'highpass', 3000, 6000);
    tone(1400, 0.1, 'square', 0.02, 180);
  },
  relay: () => click(0.3, 1400),
  /** A drop of water with somewhere to fall. */
  plink: () => tone(1250, 0.07, 'sine', 0.04, 1900),
  chime: () => {
    tone(784, 0.14, 'triangle', 0.045);
    later(110, () => tone(1175, 0.24, 'triangle', 0.045));
  },
  /** The great door rolling: as long as it takes, which is ROLLING in vault/effects.ts, tooth by tooth. */
  rumble: () => {
    hiss(4.2, 0.2, 'lowpass', 110, 80, 0.8);
    for (let tooth = 1; tooth < 9; tooth++) later(tooth * 480, () => click(0.12, 500));
  },
  /** And arriving. */
  clunk: () => {
    tone(70, 0.28, 'sine', 0.2, 34);
    click(0.4, 420);
  },
  /** The great door trying to move, and not managing. */
  grind: () => hiss(1.1, 0.16, 'bandpass', 420, 180, 0.5),
  /** One tick of a radiation counter. */
  crackle: () => click(0.05 + Math.random() * 0.05, 2800 + Math.random() * 2600),
};

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
  ...room,
};
