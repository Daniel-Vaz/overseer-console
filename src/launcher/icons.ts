/**
 * Pictures for the status board and for the signs beside messages, cut from
 * icon sheets made for this project. Each file's transparency follows the
 * brightness of the artwork, so the console can show it as a single-colour
 * phosphor image.
 */
import audio from '../assets/icons/audio.png';
import back from '../assets/icons/back.png';
import credits from '../assets/icons/credits.png';
import exportSave from '../assets/icons/export-save.png';
import external from '../assets/icons/external.png';
import fault from '../assets/icons/fault.png';
import folder from '../assets/icons/folder.png';
import fullscreen from '../assets/icons/fullscreen.png';
import gamedata from '../assets/icons/gamedata.png';
import holodisk01 from '../assets/icons/holodisk-01.png';
import holodisk02 from '../assets/icons/holodisk-02.png';
import importSave from '../assets/icons/import-save.png';
import key from '../assets/icons/key.png';
import keypad from '../assets/icons/keypad.png';
import link from '../assets/icons/link.png';
import manual from '../assets/icons/manual.png';
import memory from '../assets/icons/memory.png';
import movies from '../assets/icons/movies.png';
import ok from '../assets/icons/ok.png';
import picture from '../assets/icons/picture.png';
import play from '../assets/icons/play.png';
import pointerFinger from '../assets/icons/pointer-finger.png';
import pointerTrackpad from '../assets/icons/pointer-trackpad.png';
import save from '../assets/icons/save.png';
import scaling from '../assets/icons/scaling.png';
import sealed from '../assets/icons/sealed.png';
import settings from '../assets/icons/settings.png';
import terminal from '../assets/icons/terminal.png';
import tube from '../assets/icons/tube.png';
import unlink from '../assets/icons/unlink.png';
import unsealed from '../assets/icons/unsealed.png';
import uplink from '../assets/icons/uplink.png';
import warning from '../assets/icons/warning.png';

export const ICONS = {
  audio,
  back,
  credits,
  'export-save': exportSave,
  external,
  fault,
  folder,
  fullscreen,
  gamedata,
  'holodisk-01': holodisk01,
  'holodisk-02': holodisk02,
  'import-save': importSave,
  key,
  keypad,
  link,
  manual,
  memory,
  movies,
  ok,
  picture,
  play,
  'pointer-finger': pointerFinger,
  'pointer-trackpad': pointerTrackpad,
  save,
  scaling,
  sealed,
  settings,
  terminal,
  tube,
  unlink,
  unsealed,
  uplink,
  warning,
};

export type IconName = keyof typeof ICONS;
