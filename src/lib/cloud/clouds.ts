/**
 * The clouds the console can be linked to, and the one it is linked to.
 *
 * One at a time: every Upload, Fetch and Load entry names the cloud it uses,
 * and two linked at once would double each of them.
 */
import { dropboxCloud } from '../dropbox/cloud';
import { driveCloud } from '../drive/cloud';
import { LinkError } from './errors';
import type { Cloud, CloudId } from './provider';

export const CLOUDS: Record<CloudId, Cloud> = { dropbox: dropboxCloud, drive: driveCloud };

/** The cloud this browser is linked to. Should two tabs have linked one each at once, the later link counts. */
export function activeCloud(): Cloud | null {
  let found: Cloud | null = null;
  let at = -1;
  for (const cloud of Object.values(CLOUDS)) {
    const link = cloud.link();
    if (link && link.linkedAt > at) {
      found = cloud;
      at = link.linkedAt;
    }
  }
  return found;
}

export function requireCloud(): Cloud {
  const cloud = activeCloud();
  if (!cloud) throw new LinkError('The console is not linked to a cloud. Link one under Cloud link in Terminal settings.');
  return cloud;
}
