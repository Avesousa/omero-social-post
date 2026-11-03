// Compile-time guard: every catalog must have exactly the same keys as the Spanish source.
// `pnpm typecheck` fails when a key is missing in either direction.
import type en from '../messages/en.json';
import type es from '../messages/es.json';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const enMatchesEs: Equal<typeof en, typeof es> = true;
