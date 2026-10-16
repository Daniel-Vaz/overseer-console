/**
 * Changes to a copy of a file the editor writes: words and bytes changed where
 * they are, and stretches replaced by others of another length. What was not
 * changed can then be found in the result, and proved untouched.
 */
export class Splicer {
  private readonly copy: Uint8Array;
  private readonly view: DataView;
  /** Ranges, in the original's offsets, that writing may change in place. */
  readonly changed: [number, number][] = [];
  /** Stretches of the original replaced by new bytes, in no particular order. */
  private readonly cuts: { start: number; end: number; bytes: Uint8Array }[] = [];

  constructor(readonly original: Uint8Array) {
    this.copy = original.slice();
    this.view = new DataView(this.copy.buffer, this.copy.byteOffset, this.copy.byteLength);
  }

  int(at: number, value: number): void {
    this.view.setInt32(at, value | 0, false);
    this.changed.push([at, at + 4]);
  }

  ints(at: number, values: readonly number[]): void {
    values.forEach((value, index) => this.view.setInt32(at + index * 4, value | 0, false));
    this.changed.push([at, at + values.length * 4]);
  }

  /** A word as it now stands (with what was changed in place). */
  read(at: number): number {
    return this.view.getInt32(at, false);
  }

  short(at: number, value: number): void {
    this.view.setInt16(at, value, false);
    this.changed.push([at, at + 2]);
  }

  text(at: number, length: number, value: string): void {
    this.copy.fill(0, at, at + length);
    for (let i = 0; i < Math.min(value.length, length - 1); i++) this.copy[at + i] = value.charCodeAt(i) & 0xff;
    this.changed.push([at, at + length]);
  }

  byte(at: number, value: number): void {
    this.copy[at] = value & 0xff;
    this.changed.push([at, at + 1]);
  }

  /** Replaces the original's bytes from `start` to `end` with `bytes`. Stretches must not overlap. */
  splice(start: number, end: number, bytes: Uint8Array): void {
    if (this.cuts.some((cut) => start < cut.end && cut.start < end)) throw new Error('overlapping changes');
    this.cuts.push({ start, end, bytes });
  }

  /** The changed file, and where each byte of the original that was kept now lies (-1: it was cut out). */
  build(): { data: Uint8Array; moved: (offset: number) => number } {
    const cuts = [...this.cuts].sort((a, b) => a.start - b.start);
    const length = cuts.reduce((sum, cut) => sum + cut.bytes.length - (cut.end - cut.start), this.copy.length);
    const data = new Uint8Array(length);
    let from = 0;
    let to = 0;
    for (const cut of cuts) {
      data.set(this.copy.subarray(from, cut.start), to);
      to += cut.start - from;
      data.set(cut.bytes, to);
      to += cut.bytes.length;
      from = cut.end;
    }
    data.set(this.copy.subarray(from), to);
    const moved = (offset: number): number => {
      let shift = 0;
      for (const cut of cuts) {
        if (offset < cut.start) break;
        if (offset < cut.end) return -1;
        shift += cut.bytes.length - (cut.end - cut.start);
      }
      return offset + shift;
    };
    return { data, moved };
  }

  /** Whether an offset of the original is one the changes in place may have touched. */
  free(offset: number): boolean {
    return this.changed.some(([from, to]) => offset >= from && offset < to);
  }

  /**
   * Proves that the built file holds every byte of the original that no
   * change was meant to touch, where it now lies. Returns the first offset
   * that does not, or -1.
   */
  untouched(result: { data: Uint8Array; moved: (offset: number) => number }): number {
    const free = new Uint8Array(this.original.length);
    for (const [from, to] of this.changed) free.fill(1, from, to);
    const cuts = [...this.cuts].sort((a, b) => a.start - b.start);
    let shift = 0;
    let next = 0;
    for (let i = 0; i < this.original.length; i++) {
      const cut = cuts[next];
      if (cut && i >= cut.start) {
        if (i < cut.end) continue;
        shift += cut.bytes.length - (cut.end - cut.start);
        next++;
        i--;
        continue;
      }
      if (!free[i] && result.data[i + shift] !== this.original[i]) return i;
    }
    return -1;
  }
}

/** Joins byte arrays. */
export function concat(pieces: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}
