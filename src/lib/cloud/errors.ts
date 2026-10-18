/**
 * What can go wrong with the player's cloud, whichever it is.
 */

/** Something about the link that the player has to act on. */
export class LinkError extends Error {
  override name = 'LinkError';
}

/** A request the cloud refused, or could not be reached for. */
export class CloudError extends Error {
  override name = 'CloudError';

  constructor(
    message: string,
    /** The HTTP status, or 0 when the cloud could not be reached. 409: not the file that was looked at. */
    readonly status: number,
    /** The cloud's own word for what went wrong. */
    readonly summary = '',
  ) {
    super(message);
  }

  /** The file or folder is not there. */
  get notFound(): boolean {
    return this.status === 404;
  }

  /** The file changed in the cloud since it was last looked at. */
  get conflict(): boolean {
    return this.status === 409;
  }
}
