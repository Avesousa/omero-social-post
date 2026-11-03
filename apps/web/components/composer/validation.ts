import { PROVIDER_LIMITS, validatePostInput, type MediaInfo } from '@omero/shared';
import type { ProblemFieldError } from '@omero/api-client';
import { toPostInput, type ComposerState } from './state';
import { toChannelContext, type ComposerChannel } from './use-channels';

/** One validation problem at a dotted path such as `channels.0.items.1.text`. */
export interface Issue {
  path: string;
  code: string;
  message: string;
  params?: Record<string, string | number | boolean> | undefined;
}

/** `channels[0].items[1].text` (API) and `channels.0.items.1.text` (shared) are the same path. */
export function normalizePath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1');
}

export function issuePath(channelIndex: number, itemIndex: number, field: 'text' | 'mediaIds') {
  return `channels.${channelIndex}.items.${itemIndex}.${field}`;
}

/** Runs the exact checks the API runs on save, so the composer gives the same answers instantly. */
export function validateComposer(
  state: ComposerState,
  channels: readonly ComposerChannel[],
): Issue[] {
  const known = channels.filter((c) => state.selected.includes(c.id));
  const media = new Map<string, MediaInfo>();
  for (const [id, ref] of Object.entries(state.media)) {
    // Size is unknown for images that came with a saved post; the API re-checks it on save.
    media.set(id, { mime: ref.mime, bytes: ref.bytes ?? 0 });
  }
  const result = validatePostInput(
    toPostInput(state),
    known.map(toChannelContext),
    PROVIDER_LIMITS,
    { media },
  );
  return result.errors.map((error) => ({
    path: normalizePath(error.path),
    code: error.code,
    message: error.message,
    params: error.params,
  }));
}

export function issuesFromProblem(errors: readonly ProblemFieldError[]): Issue[] {
  return errors.map((error) => ({
    path: normalizePath(error.path),
    code: error.code ?? 'INVALID',
    message: error.message,
  }));
}

/** Groups issues by exact path for field-level lookups. */
export function groupByPath(issues: readonly Issue[]): Map<string, Issue[]> {
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.path);
    if (list) list.push(issue);
    else grouped.set(issue.path, [issue]);
  }
  return grouped;
}

/** Codes with a translated message, and the params each one needs to be worded properly. */
export const TRANSLATED_ISSUES = {
  NO_CHANNELS: [],
  DUPLICATE_CHANNEL: [],
  UNKNOWN_CHANNEL: [],
  ITEMS_REQUIRED: [],
  TOO_MANY_ITEMS: [],
  EMPTY_ITEM: [],
  TEXT_TOO_LONG: ['length', 'limit'],
  TOO_MANY_IMAGES: ['max'],
  MEDIA_NOT_FOUND: [],
  UNSUPPORTED_MEDIA_TYPE: ['mime'],
  MEDIA_TOO_LARGE: ['max'],
  CHANNEL_DISCONNECTED: [],
} as const satisfies Record<string, readonly string[]>;

export type TranslatedIssueCode = keyof typeof TRANSLATED_ISSUES;

export function isTranslatedIssue(issue: Issue): issue is Issue & { code: TranslatedIssueCode } {
  const needed = (TRANSLATED_ISSUES as Record<string, readonly string[]>)[issue.code];
  if (!needed) return false;
  return needed.every((name) => issue.params?.[name] !== undefined);
}
