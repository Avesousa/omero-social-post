'use client';

import { useMemo } from 'react';
import { useChannelsControllerList, type ChannelDtoOutput } from '@omero/api-client';
import type { ChannelContext, ChannelStatus, ProviderId } from '@omero/shared';

/** A connected account as the composer uses it. */
export interface ComposerChannel {
  id: string;
  provider: ProviderId;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: ChannelStatus;
  /** X Premium long posts: raises the X character limit. */
  longPostsEnabled: boolean;
}

/**
 * The generated client types nullable strings of this DTO as `string[]` (an OpenAPI generation
 * quirk reported in the T027/T029 notes); at runtime they are `string | null`.
 */
function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalize(channel: ChannelDtoOutput): ComposerChannel {
  return {
    id: channel.id,
    provider: channel.provider,
    handle: channel.handle,
    displayName: nullableString(channel.displayName),
    avatarUrl: nullableString(channel.avatarUrl),
    status: channel.status,
    longPostsEnabled: channel.settings.longPostsEnabled,
  };
}

/** Accounts the composer can publish to, in provider order (X, then LinkedIn). Single source for channels. */
export function useChannels() {
  const query = useChannelsControllerList();

  const channels = useMemo(() => {
    const rank = (c: ComposerChannel) => (c.provider === 'x' ? 0 : 1);
    return (query.data ?? []).map(normalize).sort((a, b) => rank(a) - rank(b));
  }, [query.data]);

  return {
    channels,
    isPending: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** What `validatePostInput` needs to know about a channel. */
export function toChannelContext(channel: ComposerChannel): ChannelContext {
  return {
    id: channel.id,
    provider: channel.provider,
    settings: { longPostsEnabled: channel.longPostsEnabled },
  };
}
