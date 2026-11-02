import { describe, expect, it } from 'vitest';
import { COMMANDS, OWN_BUTTONS, buttonLabel, ownButtons } from '../../src/player/touch/buttons';
import { keyByCode } from '../../src/player/touch/keyboard';

describe("the player's own touch buttons", () => {
  it('are named for what they do in the games, or else for their key', () => {
    expect(buttonLabel('KeyB')).toBe('HAND');
    expect(buttonLabel('Digit2')).toBe('LOCKPK');
    expect(buttonLabel('KeyQ')).toBe('Q');
    expect(buttonLabel('F8')).toBe('F8');
    expect(buttonLabel('ArrowLeft')).toBe('LEFT');
    expect(buttonLabel('Backspace')).toBe('BKSP');
  });

  it('say six letters at most, and press keys the console can send', () => {
    for (const command of COMMANDS) {
      expect(command.label.length, command.label).toBeLessThanOrEqual(6);
      expect(keyByCode(command.code), command.code).toBeDefined();
    }
  });

  it('come in four slots, a key the console cannot send leaving its slot empty', () => {
    expect(ownButtons(undefined)).toEqual(['', '', '', '']);
    expect(ownButtons(['KeyB', 'F12', 'Digit1'])).toEqual(['KeyB', '', 'Digit1', '']);
    expect(ownButtons(['KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF'])).toHaveLength(OWN_BUTTONS);
  });
});
