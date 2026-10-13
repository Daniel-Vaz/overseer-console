/**
 * What comes back when the room is meddled with: a sound, and a word on the
 * nameplate of the housing.
 */

/** The sounds the room can ask the console to make. Each has its recipe in sfx.ts. */
export type Sound =
  | 'squash'
  | 'bark'
  | 'squeak'
  | 'groan'
  | 'growl'
  | 'rattle'
  | 'clang'
  | 'thud'
  | 'zap'
  | 'relay'
  | 'plink'
  | 'chime'
  | 'rumble'
  | 'clunk'
  | 'grind'
  | 'crackle';

/**
 * What the nameplate says. Every remark is as long as the console's own
 * name, so that the plate keeps its width while it speaks.
 */
export const REMARKS = {
  dog: "WHO'S A GOOD BOY",
  ghoul: 'DO NOT POKE THEM',
  upset: 'NOW IT IS UPSET.',
  glowing: 'RADS: OFF SCALE.',
  molerat: 'MOLE RAT: MISSED',
  eyes: 'IT SAW YOU FIRST',
  card: 'PLEASE STAND BY.',
  eye: 'OVERSEER ON DUTY',
  standby: 'MONITOR: STANDBY',
  skeleton: 'LEAVE HIM ALONE.',
  mended: 'WATER CHIP: OKAY',
  meddled: 'DO NOT TOUCH IT.',
  garden: 'G.E.C.K. ENGAGED',
  bloom: 'ALREADY IN BLOOM',
  knock: 'KNOCK, KNOCK...?',
  answer: 'SOMEONE IS HOME.',
  echo: 'HELLO? ...HELLO?',
  shut: 'VAULT DOOR: SHUT',
  open: 'VAULT DOOR: OPEN',
  jammed: 'DOOR JAMMED OPEN',
  parade: 'ROLL THE CREDITS',
  drip: 'DO NOT DRINK IT.',
  power: 'OFF AND ON AGAIN',
} as const;

/** A lamp reports that it has been switched. */
export function lampRemark(number: number, on: boolean): string {
  return `LAMP ${String(number % 100).padStart(2, '0')}: ${on ? 'ONLINE.' : 'OFFLINE'}`;
}

/** A knock at one of the quarters. Where the light is still kept on, somebody would rather it had not been noticed. */
export function roomRemark(number: number, home: boolean): string {
  return `ROOM ${String(number % 100).padStart(2, '0')}: ${home ? 'GO AWAY' : 'VACANT.'}`;
}

/** The count of radroaches that have met their end on this console. */
export function tally(count: number): string {
  return `RADROACHES: ${String(Math.min(count, 9999)).padStart(4, '0')}`;
}
