/*
 * Runs on the audio thread: plays whatever the page has queued.
 *
 * The page sends blocks of samples (one Float32Array per channel) and this
 * processor hands them to the sound card at its own steady pace, reporting
 * back how much is left so the page can keep the queue topped up.
 */
class OverseerSink extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = [];
    this.offset = 0;
    this.queued = 0;
    this.underruns = 0;
    // Playback holds off until `threshold` frames are queued, at the start
    // and again after running dry, so a thin queue does not stutter.
    this.playing = false;
    this.threshold = 0;
    this.quantum = 0;
    this.port.onmessage = (event) => {
      if (Array.isArray(event.data)) {
        this.blocks.push(event.data);
        this.queued += event.data[0].length;
      } else {
        this.threshold = event.data.threshold;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const frames = output[0].length;
    let written = 0;
    if (!this.playing && this.queued >= Math.max(this.threshold, frames)) this.playing = true;
    while (this.playing && written < frames && this.blocks.length) {
      const block = this.blocks[0];
      const count = Math.min(frames - written, block[0].length - this.offset);
      for (let channel = 0; channel < output.length; channel++) {
        const source = block[Math.min(channel, block.length - 1)];
        output[channel].set(source.subarray(this.offset, this.offset + count), written);
      }
      written += count;
      this.offset += count;
      if (this.offset >= block[0].length) {
        this.blocks.shift();
        this.offset = 0;
      }
    }
    this.queued -= written;
    // Running dry while playing is an audible gap: count it and refill first.
    if (this.playing && written < frames) {
      this.underruns++;
      this.playing = false;
    }

    // Report every few quanta (a quantum is 128 frames, about 3 ms).
    if (++this.quantum % 3 === 0 || this.queued === 0) {
      this.port.postMessage({ queued: this.queued, underruns: this.underruns });
    }
    return true;
  }
}

registerProcessor('overseer-sink', OverseerSink);
