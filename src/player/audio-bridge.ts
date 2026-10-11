/**
 * Buffered sound output for the engines.
 *
 * SDL plays sound through a ScriptProcessorNode: the browser calls into the
 * engine on the page's main thread every 23 ms and plays what it gets. Any
 * time the main thread is late (a garbage collection, a long stretch of game
 * logic, a slow frame) the sound card runs dry and you hear a click or a gap.
 *
 * The bridge stands in for that node. It pulls sound from SDL ahead of time
 * and hands it to an AudioWorklet, which plays from its own thread. As long
 * as the main thread is not late by more than what is queued, nothing is
 * heard. The price is that much added delay on every sound.
 */
import sinkUrl from './audio-sink.worklet.js?url';

export interface AudioBridgeStats {
  mode: 'buffered' | 'direct' | 'idle';
  /** Gaps the listener would have heard. */
  underruns: number;
  queuedMs: number;
  targetMs: number;
  pulls: number;
}

interface FakeEvent {
  outputBuffer: { numberOfChannels: number; length: number; sampleRate: number; getChannelData(channel: number): Float32Array };
}

type Handler = ((event: FakeEvent) => void) | null;

const stats: AudioBridgeStats = { mode: 'idle', underruns: 0, queuedMs: 0, targetMs: 0, pulls: 0 };

export function audioBridgeStats(): AudioBridgeStats {
  return { ...stats };
}

/** Starting queue length, and how far it may grow when gaps keep happening. */
const TARGET_MS = 70;
const MAX_TARGET_MS = 220;

/**
 * Replaces SDL's playback node with the buffered output. Must be called before
 * the engine starts. Falls back to SDL's own path when worklets are missing.
 */
export function installAudioBridge(): void {
  const original = AudioContext.prototype.createScriptProcessor;
  if (typeof AudioWorkletNode === 'undefined' || !('audioWorklet' in AudioContext.prototype)) {
    stats.mode = 'direct';
    return;
  }

  AudioContext.prototype.createScriptProcessor = function (this: AudioContext, bufferSize?: number, inputs?: number, outputs?: number) {
    // Only playback is bridged (SDL asks for zero input channels there).
    if (inputs !== 0 || !bufferSize || !outputs) return original.call(this, bufferSize, inputs, outputs);

    const context = this;
    const channels = outputs;
    const frames = bufferSize;
    let handler: Handler = null;
    let sink: AudioWorkletNode | null = null;
    let fallback: ScriptProcessorNode | null = null;
    let queued = 0;
    let pending = 0;
    let targetFrames = Math.ceil((TARGET_MS / 1000) * context.sampleRate);
    let seenUnderruns = 0;
    stats.targetMs = TARGET_MS;

    /** Asks SDL for one buffer of sound and queues it on the audio thread. */
    const pull = () => {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      try {
        handler?.({
          outputBuffer: { numberOfChannels: channels, length: frames, sampleRate: context.sampleRate, getChannelData: (channel) => data[channel]! },
        });
      } catch (err) {
        console.error('[audio] the engine failed to produce sound', err);
        return false;
      }
      pending += frames;
      stats.pulls++;
      sink!.port.postMessage(data, data.map((channel) => channel.buffer));
      return true;
    };

    const topUp = () => {
      if (!sink || !handler || context.state !== 'running') return;
      // A handful per turn at most: after a long stall, catch up without flooding.
      for (let i = 0; i < 6 && queued + pending < targetFrames; i++) {
        if (!pull()) break;
      }
    };

    context.audioWorklet.addModule(sinkUrl).then(
      () => {
        sink = new AudioWorkletNode(context, 'overseer-sink', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [channels] });
        const node = sink;
        // Playback starts once most of the target is queued.
        const sendThreshold = () => node.port.postMessage({ threshold: Math.floor(targetFrames * 0.75) });
        sendThreshold();
        sink.port.onmessage = (event: MessageEvent<{ queued: number; underruns: number }>) => {
          queued = event.data.queued;
          pending = 0;
          if (event.data.underruns > seenUnderruns) {
            // The queue was too short for this machine: lengthen it a little.
            seenUnderruns = event.data.underruns;
            targetFrames = Math.min(Math.ceil((MAX_TARGET_MS / 1000) * context.sampleRate), Math.ceil(targetFrames * 1.25));
            stats.targetMs = Math.round((targetFrames / context.sampleRate) * 1000);
            sendThreshold();
          }
          stats.underruns = event.data.underruns;
          stats.queuedMs = Math.round((queued / context.sampleRate) * 1000);
          topUp();
        };
        sink.connect(context.destination);
        stats.mode = 'buffered';
        topUp();
      },
      (err: unknown) => {
        // No worklet after all: let the browser drive SDL directly.
        console.warn('[audio] buffered output unavailable, using direct output', err);
        fallback = original.call(context, frames, 0, channels);
        fallback.onaudioprocess = handler as unknown as ScriptProcessorNode['onaudioprocess'];
        fallback.connect(context.destination);
        stats.mode = 'direct';
      },
    );
    // The audio thread only reports while the context runs; this covers the
    // moment it starts or resumes.
    const timer = window.setInterval(topUp, 15);

    // The few members of ScriptProcessorNode that SDL touches.
    const node = {
      bufferSize: frames,
      get onaudioprocess(): Handler {
        return handler;
      },
      set onaudioprocess(value: Handler) {
        handler = value;
        if (fallback) fallback.onaudioprocess = value as unknown as ScriptProcessorNode['onaudioprocess'];
      },
      connect() {
        return undefined;
      },
      disconnect() {
        window.clearInterval(timer);
        sink?.disconnect();
        fallback?.disconnect();
        handler = null;
      },
    };
    return node as unknown as ScriptProcessorNode;
  };
}
