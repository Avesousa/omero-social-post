import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'omero:isPublic';

/**
 * Marks a route (or controller) as reachable without a session.
 * The global session guard (T014) must honour this metadata; everything else is private.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
