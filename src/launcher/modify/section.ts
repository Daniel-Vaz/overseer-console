/** What the sections of the save editor share. */
import type { Editor } from './editor.svelte';

/** Says something on the editor's status line; `bad` for what could not be done. */
export type Say = (text: string, bad?: boolean) => void;

/** One line of a ledger: a thing the save holds, and what it is now. */
export interface LedgerRow {
  /** Stays the same while the row is on the list. */
  key: string;
  label: string;
  /** A sign before the label: tagged, taken. */
  mark?: string;
  /** A small picture before the label. */
  picture?: Promise<string | null> | null;
  value?: string;
  tone?: 'amber' | 'alert' | 'hot' | 'dim';
  /** What the line is about, on the line under the screen. */
  note?: string;
  /** The heading it stands under, with its neighbours that name the same one. */
  group?: string;
  /** Can be looked at, not changed. */
  locked?: boolean;
  /** ← and →: one step down or up (with SHIFT, a big one). */
  adjust?: (direction: 1 | -1, big: boolean) => void;
  /** Whether a step down, or up, would change anything. */
  less?: boolean;
  more?: boolean;
  /** ENTER: does this, or (with `input`) lets the player type the value. */
  action?: () => void;
  input?: { value: string; maxLength: number; numeric?: boolean; apply: (text: string) => void };
}

export interface SectionProps {
  editor: Editor;
  say: Say;
}

/** A whole number typed by the player, or null. */
export function typed(text: string): number | null {
  const digits = text.replace(/[\s,.]/g, '');
  return /^-?\d+$/.test(digits) ? Number(digits) : null;
}

export const thousands = (value: number): string => value.toLocaleString('en-US');

/**
 * What makes a line hold a number: steps with ← and →, a bigger step with
 * SHIFT, ENTER to type it. Spread into the line.
 */
export function stepper(spec: {
  current: number;
  set: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  bigStep?: number;
  digits?: number;
}): Pick<LedgerRow, 'adjust' | 'input' | 'less' | 'more'> {
  const { current, set, min, max, step = 1, bigStep = 10, digits = 6 } = spec;
  return {
    less: current > min,
    more: current < max,
    adjust: (direction, big) => set(current + direction * (big ? bigStep : step)),
    input: {
      value: String(current),
      maxLength: digits,
      numeric: true,
      apply: (text) => {
        const value = typed(text);
        if (value !== null) set(value);
      },
    },
  };
}
