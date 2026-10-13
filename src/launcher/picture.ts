/** The pictures a game can be played at, as the console names and explains them. */
import { PICTURES, type Picture } from '../lib/settings';

export const PICTURE_NAMES: Record<Picture, string> = { classic: 'CLASSIC 4:3', wide: 'WIDE', high: 'HIGH RESOLUTION' };

export const PICTURE_NOTES: Record<Picture, string> = {
  classic: 'The original 640 x 480 picture. The most faithful choice.',
  wide: 'Same zoom as the original, widened to the shape of your window: more of the map is visible.',
  high: 'Half as tall again as the original and as wide as your window: far more of the map, everything on it smaller. The picture Fallout Et Tu was laid out for.',
};

/** The entry after `current` in a list of choices (or the one before it), going round. */
export function step<T>(choices: readonly T[], current: T, direction: 1 | -1 = 1): T {
  return choices[(choices.indexOf(current) + direction + choices.length) % choices.length]!;
}

/** The picture after this one, or the one before it. */
export function nextPicture(picture: Picture, direction: 1 | -1 = 1): Picture {
  return step(PICTURES, picture, direction);
}
