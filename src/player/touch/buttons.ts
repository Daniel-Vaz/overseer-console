/**
 * The player's own buttons on the touch deck: up to four for each game, each
 * a key of the keyboard held down for as long as the button is.
 */
import { keyName } from './keyboard';

/** How many buttons of their own a player can have for each game. */
export const OWN_BUTTONS = 4;

/** A command of the games that has a key and no button on the deck, by that key's code. */
export interface Command {
  code: string;
  /** What the button says: six letters at most, so that it fits a phone's button. */
  label: string;
  /** The key, as the list of commands shows it. */
  key: string;
  what: string;
}

/** Both games answer to these keys the same way (game.cc of each engine). */
export const COMMANDS: readonly Command[] = [
  { code: 'KeyB', label: 'HAND', key: 'B', what: 'Use the other hand' },
  { code: 'KeyZ', label: 'REST', key: 'Z', what: "Rest: the Pip-Boy's clock" },
  { code: 'Home', label: 'CENTER', key: 'HOME', what: 'Back to your character' },
  { code: 'Digit1', label: 'SNEAK', key: '1', what: 'Sneak, on and off' },
  { code: 'Digit2', label: 'LOCKPK', key: '2', what: 'Lockpick, then tap what to use it on' },
  { code: 'Digit3', label: 'STEAL', key: '3', what: 'Steal, then tap what to use it on' },
  { code: 'Digit4', label: 'TRAPS', key: '4', what: 'Traps, then tap what to use it on' },
  { code: 'Digit5', label: 'F.AID', key: '5', what: 'First aid, then tap what to use it on' },
  { code: 'Digit6', label: 'DOCTOR', key: '6', what: 'Doctor, then tap what to use it on' },
  { code: 'Digit7', label: 'SCIENC', key: '7', what: 'Science, then tap what to use it on' },
  { code: 'Digit8', label: 'REPAIR', key: '8', what: 'Repair, then tap what to use it on' },
  { code: 'F4', label: 'SAVE', key: 'F4', what: 'Save game' },
  { code: 'F5', label: 'LOAD', key: 'F5', what: 'Load game' },
];

/** What a button for the key with this code says: the command's name, or else the key's. */
export function buttonLabel(code: string): string {
  return COMMANDS.find((command) => command.code === code)?.label ?? keyName(code) ?? code;
}

/** The player's buttons for a game, as kept in the settings: a key's code in each slot, or '' for none. */
export function ownButtons(stored: readonly string[] | undefined): string[] {
  return Array.from({ length: OWN_BUTTONS }, (_, slot) => {
    const code = stored?.[slot] ?? '';
    return keyName(code) ? code : '';
  });
}
