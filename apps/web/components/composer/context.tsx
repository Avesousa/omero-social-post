'use client';

import { createContext, useContext } from 'react';
import type { PostItemInput } from '@omero/shared';
import type { ChannelDraft, ComposerAction, ComposerState } from './state';
import type { Issue } from './validation';
import type { ComposerChannel } from './use-channels';

/** A selected channel with everything the editors and the summary need to render it. */
export interface ChannelView {
  channel: ComposerChannel;
  /** Position among the selected channels: the `channels.<index>` of validation paths. */
  index: number;
  draft: ChannelDraft | undefined;
  customized: boolean;
  /** What the channel will publish right now (own items when customized, derived otherwise). */
  items: PostItemInput[];
  limit: number;
}

/** Where an uploaded image gets attached. Items are addressed by key because reordering shifts indexes. */
export type UploadTarget = { kind: 'base' } | { kind: 'item'; channelId: string; itemKey: string };

export function uploadKey(target: UploadTarget): string {
  return target.kind === 'base' ? 'base' : `${target.channelId}:${target.itemKey}`;
}

export interface ComposerContextValue {
  state: ComposerState;
  dispatch: (action: ComposerAction) => void;
  channels: readonly ComposerChannel[];
  views: readonly ChannelView[];
  issues: readonly Issue[];
  issuesByPath: ReadonlyMap<string, Issue[]>;
  /** In-flight uploads by `uploadKey`. */
  uploading: Readonly<Record<string, number>>;
  upload: (target: UploadTarget, files: File[]) => void;
  readOnly: boolean;
}

const ComposerContext = createContext<ComposerContextValue | null>(null);

export const ComposerProvider = ComposerContext.Provider;

export function useComposer(): ComposerContextValue {
  const value = useContext(ComposerContext);
  if (!value) throw new Error('useComposer must be used inside the composer');
  return value;
}
