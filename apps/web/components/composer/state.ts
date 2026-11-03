import {
  deriveItems,
  getCharLimit,
  PROVIDER_LIMITS,
  splitIntoThread,
  type PostInput,
  type PostItemInput,
} from '@omero/shared';
import type { PostDetailDtoOutput } from '@omero/api-client';
import { toChannelContext, type ComposerChannel } from './use-channels';

/** An uploaded image as the composer knows it. `bytes` is unknown for images loaded with a saved post. */
export interface MediaRef {
  id: string;
  url: string;
  mime: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
}

/** One publishable unit in the editor: a single post or one entry of an X thread. */
export interface ComposerItem {
  /** Stable React key; never sent to the API. */
  key: string;
  text: string;
  mediaIds: string[];
}

/** Per-channel customization. `items` stays populated after switching back to "derived" so edits are not lost. */
export interface ChannelDraft {
  customized: boolean;
  items: ComposerItem[] | null;
}

export interface ComposerState {
  baseContent: string;
  baseMediaIds: string[];
  /** Selected channel ids, in selection order (this is also the delivery order of the payload). */
  selected: string[];
  drafts: Record<string, ChannelDraft>;
  /** Every image the editor has seen, by id. Removing an image from a post does not remove it here. */
  media: Record<string, MediaRef>;
}

let keyCounter = 0;
export function newKey(): string {
  keyCounter += 1;
  return `item-${keyCounter}`;
}

export function emptyState(): ComposerState {
  return { baseContent: '', baseMediaIds: [], selected: [], drafts: {}, media: {} };
}

export function toItem(item: PostItemInput): ComposerItem {
  return { key: newKey(), text: item.text, mediaIds: [...item.mediaIds] };
}

/** Rebuilds the editor state from a saved post. */
export function stateFromPost(post: PostDetailDtoOutput): ComposerState {
  const media: Record<string, MediaRef> = {};
  const drafts: Record<string, ChannelDraft> = {};

  for (const delivery of post.deliveries) {
    for (const item of delivery.items) {
      for (const m of item.media) {
        media[m.id] = {
          id: m.id,
          url: m.url,
          mime: m.mime,
          bytes: null,
          width: m.width,
          height: m.height,
        };
      }
    }
    drafts[delivery.channelId] = {
      customized: delivery.customized,
      items: delivery.customized
        ? delivery.items.map((item) => ({
            key: newKey(),
            text: item.text,
            mediaIds: item.media.map((m) => m.id),
          }))
        : null,
    };
  }

  return {
    baseContent: post.baseContent,
    baseMediaIds: [...post.baseMediaIds],
    selected: post.deliveries.map((d) => d.channelId),
    drafts,
    media,
  };
}

/** Request body for `POST /posts` and `PUT /posts/:id` (without `version`). */
export function toPostInput(state: ComposerState): PostInput {
  return {
    baseContent: state.baseContent,
    baseMediaIds: [...state.baseMediaIds],
    channels: state.selected.map((channelId) => {
      const draft = state.drafts[channelId];
      if (draft?.customized && draft.items) {
        return {
          channelId,
          customized: true,
          items: draft.items.map((item) => ({ text: item.text, mediaIds: [...item.mediaIds] })),
        };
      }
      return { channelId, customized: false };
    }),
  };
}

/** The items a channel will publish right now: its own when customized, otherwise derived from the base. */
export function itemsForChannel(state: ComposerState, channel: ComposerChannel): PostItemInput[] {
  const draft = state.drafts[channel.id];
  const channelInput =
    draft?.customized && draft.items
      ? {
          customized: true,
          items: draft.items.map((item) => ({ text: item.text, mediaIds: item.mediaIds })),
        }
      : { customized: false };
  return deriveItems(
    { baseContent: state.baseContent, baseMediaIds: state.baseMediaIds },
    channelInput,
    toChannelContext(channel),
  );
}

/** Character limit of a channel for its provider and settings. */
export function limitForChannel(channel: ComposerChannel): number {
  return getCharLimit(PROVIDER_LIMITS[channel.provider], {
    longPostsEnabled: channel.longPostsEnabled,
  });
}

/** Seed for "personalize" and "reset": what the channel would publish from the base content right now. */
export function seedItems(state: ComposerState, channel: ComposerChannel): ComposerItem[] {
  const derived = deriveItems(
    { baseContent: state.baseContent, baseMediaIds: state.baseMediaIds },
    { customized: false },
    toChannelContext(channel),
  );
  const items = derived.length > 0 ? derived : [{ text: '', mediaIds: [] }];
  return items.map(toItem);
}

/**
 * Splits every item above `limit` into several items, keeping the others untouched.
 * The first piece keeps the original item's images.
 */
export function autoSplitItems(items: ComposerItem[], limit: number): ComposerItem[] {
  return items.flatMap((item) => {
    const pieces = splitIntoThread(item.text, limit);
    // The splitter guarantees every piece is within the limit, so a single piece (or none, for
    // blank text) means the item already fits and stays exactly as the user typed it.
    if (pieces.length <= 1) return [item];
    return pieces.map((text, index) => ({
      key: index === 0 ? item.key : newKey(),
      text,
      mediaIds: index === 0 ? item.mediaIds : [],
    }));
  });
}

/* --------------------------------- reducer --------------------------------- */

export type ComposerAction =
  | { type: 'setBaseContent'; text: string }
  | { type: 'toggleChannel'; channelId: string }
  | { type: 'registerMedia'; media: MediaRef }
  | { type: 'addBaseMedia'; mediaId: string }
  | { type: 'removeBaseMedia'; mediaId: string }
  | { type: 'setCustomized'; channelId: string; customized: boolean; seed: ComposerItem[] }
  | { type: 'setItemText'; channelId: string; index: number; text: string }
  | { type: 'addItem'; channelId: string; afterIndex: number }
  | { type: 'removeItem'; channelId: string; index: number }
  | { type: 'moveItem'; channelId: string; index: number; direction: -1 | 1 }
  | { type: 'addItemMedia'; channelId: string; index: number; mediaId: string }
  | { type: 'removeItemMedia'; channelId: string; index: number; mediaId: string }
  | { type: 'autoSplit'; channelId: string; limit: number }
  | { type: 'resetItems'; channelId: string; seed: ComposerItem[] };

function withItems(
  state: ComposerState,
  channelId: string,
  update: (items: ComposerItem[]) => ComposerItem[],
): ComposerState {
  const draft = state.drafts[channelId];
  if (!draft?.items) return state;
  return {
    ...state,
    drafts: { ...state.drafts, [channelId]: { ...draft, items: update(draft.items) } },
  };
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'setBaseContent':
      return { ...state, baseContent: action.text };

    case 'toggleChannel': {
      const isSelected = state.selected.includes(action.channelId);
      return {
        ...state,
        selected: isSelected
          ? state.selected.filter((id) => id !== action.channelId)
          : [...state.selected, action.channelId],
      };
    }

    case 'registerMedia':
      return { ...state, media: { ...state.media, [action.media.id]: action.media } };

    case 'addBaseMedia':
      return state.baseMediaIds.includes(action.mediaId)
        ? state
        : { ...state, baseMediaIds: [...state.baseMediaIds, action.mediaId] };

    case 'removeBaseMedia':
      return { ...state, baseMediaIds: state.baseMediaIds.filter((id) => id !== action.mediaId) };

    case 'setCustomized': {
      const current = state.drafts[action.channelId];
      const items = current?.items ?? (action.customized ? action.seed : null);
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.channelId]: { customized: action.customized, items },
        },
      };
    }

    case 'setItemText':
      return withItems(state, action.channelId, (items) =>
        items.map((item, i) => (i === action.index ? { ...item, text: action.text } : item)),
      );

    case 'addItem':
      return withItems(state, action.channelId, (items) => [
        ...items.slice(0, action.afterIndex + 1),
        { key: newKey(), text: '', mediaIds: [] },
        ...items.slice(action.afterIndex + 1),
      ]);

    case 'removeItem':
      return withItems(state, action.channelId, (items) =>
        items.length <= 1 ? items : items.filter((_, i) => i !== action.index),
      );

    case 'moveItem':
      return withItems(state, action.channelId, (items) => {
        const target = action.index + action.direction;
        if (target < 0 || target >= items.length) return items;
        const next = [...items];
        [next[action.index], next[target]] = [next[target]!, next[action.index]!];
        return next;
      });

    case 'addItemMedia':
      return withItems(state, action.channelId, (items) =>
        items.map((item, i) =>
          i === action.index && !item.mediaIds.includes(action.mediaId)
            ? { ...item, mediaIds: [...item.mediaIds, action.mediaId] }
            : item,
        ),
      );

    case 'removeItemMedia':
      return withItems(state, action.channelId, (items) =>
        items.map((item, i) =>
          i === action.index
            ? { ...item, mediaIds: item.mediaIds.filter((id) => id !== action.mediaId) }
            : item,
        ),
      );

    case 'autoSplit':
      return withItems(state, action.channelId, (items) => autoSplitItems(items, action.limit));

    case 'resetItems': {
      const draft = state.drafts[action.channelId];
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.channelId]: { customized: draft?.customized ?? true, items: action.seed },
        },
      };
    }
  }
}
