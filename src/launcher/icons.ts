/**
 * Pictures for the status board, cut from an icon sheet made for this
 * project. Each file's transparency follows the brightness of the artwork,
 * so the console can show it as a single-colour phosphor image.
 */
import audio from '../assets/icons/audio.png';
import back from '../assets/icons/back.png';
import exportSave from '../assets/icons/export-save.png';
import gamedata from '../assets/icons/gamedata.png';
import importSave from '../assets/icons/import-save.png';
import play from '../assets/icons/play.png';
import save from '../assets/icons/save.png';
import settings from '../assets/icons/settings.png';
import terminal from '../assets/icons/terminal.png';

export const ICONS = { audio, back, 'export-save': exportSave, gamedata, 'import-save': importSave, play, save, settings, terminal };

export type IconName = keyof typeof ICONS;
