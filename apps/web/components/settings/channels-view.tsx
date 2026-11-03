'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLinkIcon, PlugZapIcon, TriangleAlertIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getChannelsControllerListQueryKey,
  useChannelsControllerDisconnect,
  useChannelsControllerList,
  useChannelsControllerUpdate,
  useProvidersControllerList,
  type ChannelDtoOutput,
  type ProviderInfoDtoOutput,
} from '@omero/api-client';
import { NetworkAvatar } from '@/components/common/network-badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { formatInstant } from './owner-settings';

const DOCS_URL = 'https://github.com/Avesousa/omero-social-post/blob/main/docs/es/self-hosting.md';

const CONNECT_ERRORS = [
  'access_denied',
  'provider_error',
  'state_invalid',
  'state_mismatch',
  'missing_code',
  'exchange_failed',
  'profile_failed',
  'not_configured',
  'unknown',
] as const;
type ConnectError = (typeof CONNECT_ERRORS)[number];

function isConnectError(value: string): value is ConnectError {
  return (CONNECT_ERRORS as readonly string[]).includes(value);
}

/** The generated client types nullable strings as `string[]`; at runtime they are `string | null`. */
function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Reads `?connected=` / `?error=` left by the OAuth callback, toasts it and cleans the URL. */
function ConnectResultToaster() {
  const params = useSearchParams();
  const router = useRouter();
  const t = useTranslations('Settings.channels.connectResult');
  const tn = useTranslations('Network');
  const connected = params.get('connected');
  const error = params.get('error');

  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!connected && !error) return;
    // Strict Mode runs effects twice before the URL is cleaned; toast each result once.
    if (handled.current === `${connected}|${error}`) return;
    handled.current = `${connected}|${error}`;
    if (error) {
      toast.error(t('errorTitle'), {
        description: t(`errors.${isConnectError(error) ? error : 'unknown'}`),
      });
    } else if (connected === 'x' || connected === 'linkedin') {
      toast.success(t('connected', { network: tn(connected) }));
    }
    router.replace('/settings/channels', { scroll: false });
  }, [connected, error, router, t, tn]);

  return null;
}

function ProviderCard({
  provider,
  channel,
  onDisconnect,
}: {
  provider: ProviderInfoDtoOutput;
  channel: ChannelDtoOutput | undefined;
  onDisconnect: (channel: ChannelDtoOutput) => void;
}) {
  const t = useTranslations('Settings.channels');
  const tn = useTranslations('Network');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const update = useChannelsControllerUpdate();
  const [redirecting, setRedirecting] = useState(false);

  const network = provider.id;
  const networkName = tn(network);
  const status = channel?.status;
  const needsReconnect = status === 'needs_reconnect';
  const isConnected = status === 'connected';
  const displayName = channel ? nullableString(channel.displayName) : null;
  const avatarUrl = channel ? nullableString(channel.avatarUrl) : null;
  const canConnect = provider.configured && !redirecting;

  function connect() {
    setRedirecting(true);
    // The OAuth start is a 302 to the network, so the browser must navigate (fetch cannot follow it).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/v1/channels/${network}/connect`);
  }

  function toggleLongPosts(checked: boolean) {
    if (!channel) return;
    update.mutate(
      { id: channel.id, data: { settings: { longPostsEnabled: checked } } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: getChannelsControllerListQueryKey() }),
        onError: () => toast.error(t('longPosts.saveError')),
      },
    );
  }

  const expiry = channel?.tokenExpiresAt ?? null;
  const expiryDate = expiry
    ? formatInstant(expiry, locale, 'UTC', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const badgeLabel = status ? t(`status.${status}`) : t('status.notConnected');

  return (
    <article
      data-network={network}
      data-testid={`channel-card-${network}`}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm',
        needsReconnect && 'border-warning/60 bg-warning/5 ring-1 ring-warning/30',
      )}
    >
      <header className="flex items-start gap-3">
        <div className="relative">
          <Avatar className="size-12">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback className="tone-soft text-base">
              {(displayName ?? channel?.handle ?? networkName)
                .replace(/^@/, '')
                .charAt(0)
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <NetworkAvatar
            network={network}
            className="absolute -right-1 -bottom-1 size-5 ring-2 ring-card"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base leading-tight font-semibold">
            {displayName ?? networkName}
          </h3>
          <p className="truncate text-sm text-muted-foreground">
            {channel ? channel.handle : networkName}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            isConnected && 'border-success/40 bg-success/10 text-success',
            needsReconnect && 'border-warning/50 bg-warning/10 text-warning',
            !isConnected && !needsReconnect && 'text-muted-foreground',
          )}
        >
          {needsReconnect ? <TriangleAlertIcon aria-hidden="true" /> : null}
          {badgeLabel}
        </Badge>
      </header>

      {!channel ? (
        <p className="text-sm text-muted-foreground">
          {t('card.notConnectedBody', { network: networkName })}
        </p>
      ) : null}
      {status === 'disconnected' ? (
        <p className="text-sm text-muted-foreground">{t('card.disconnectedBody')}</p>
      ) : null}
      {needsReconnect ? (
        <p className="text-sm text-foreground/80">{t('card.needsReconnectBody')}</p>
      ) : null}

      {channel && isConnected && expiryDate ? (
        <p className="text-sm text-muted-foreground">
          {network === 'linkedin'
            ? t('expiry.linkedin', { date: expiryDate })
            : t('expiry.autoRenew')}
        </p>
      ) : null}
      {channel && needsReconnect && network === 'linkedin' && expiryDate ? (
        <p className="text-sm text-muted-foreground">
          {t('expiry.linkedin', { date: expiryDate })}
        </p>
      ) : null}

      {!provider.configured ? (
        <div className="rounded-xl border border-dashed bg-muted/50 p-3 text-sm">
          <p className="font-semibold">{t('notConfigured.title', { network: networkName })}</p>
          <p className="mt-1 text-muted-foreground">{t('notConfigured.body')}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {provider.missingEnv.map((name) => (
              <li key={name}>
                <code className="rounded-md bg-card px-1.5 py-0.5 font-mono text-xs ring-1 ring-border">
                  {name}
                </code>
              </li>
            ))}
          </ul>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            {t('notConfigured.docs')}
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      ) : null}

      {channel && network === 'x' && channel.status !== 'disconnected' ? (
        <div className="flex items-start justify-between gap-4 rounded-xl bg-muted/50 p-3">
          <div className="min-w-0">
            <label htmlFor={`long-posts-${channel.id}`} className="text-sm font-semibold">
              {t('longPosts.label')}
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('longPosts.description')}</p>
          </div>
          <Switch
            id={`long-posts-${channel.id}`}
            checked={channel.settings.longPostsEnabled}
            disabled={update.isPending}
            onCheckedChange={toggleLongPosts}
          />
        </div>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center gap-2">
        {!channel || status !== 'connected' ? (
          <Button
            variant={needsReconnect ? 'crema' : 'default'}
            disabled={!canConnect}
            onClick={connect}
            aria-label={
              needsReconnect
                ? t('card.reconnectAria', { handle: channel?.handle ?? networkName })
                : t('card.connectAria', { network: networkName })
            }
          >
            <PlugZapIcon aria-hidden="true" />
            {redirecting
              ? t('card.redirecting')
              : needsReconnect
                ? t('card.reconnect')
                : t('card.connect')}
          </Button>
        ) : null}
        {channel && status !== 'disconnected' ? (
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={t('card.disconnectAria', { handle: channel.handle })}
            onClick={() => onDisconnect(channel)}
          >
            {t('card.disconnect')}
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

function DisconnectDialog({
  channel,
  onClose,
}: {
  channel: ChannelDtoOutput | null;
  onClose: () => void;
}) {
  const t = useTranslations('Settings.channels.disconnectDialog');
  const tc = useTranslations('Common');
  const queryClient = useQueryClient();
  const disconnect = useChannelsControllerDisconnect();

  function confirm() {
    if (!channel) return;
    disconnect.mutate(
      { id: channel.id },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getChannelsControllerListQueryKey() });
          toast.success(t('done'));
          onClose();
        },
        onError: () => toast.error(t('error')),
      },
    );
  }

  return (
    <Dialog open={channel !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { handle: channel?.handle ?? '' })}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {t('scheduledNote')}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={disconnect.isPending}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={disconnect.isPending}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChannelsView() {
  const t = useTranslations('Settings.channels');
  const providers = useProvidersControllerList();
  const channels = useChannelsControllerList();
  const [toDisconnect, setToDisconnect] = useState<ChannelDtoOutput | null>(null);

  // One card per provider (X, then LinkedIn), showing the most relevant account for it.
  const cards = useMemo(() => {
    const rank = (id: string) => (id === 'x' ? 0 : 1);
    return [...(providers.data ?? [])]
      .sort((a, b) => rank(a.id) - rank(b.id))
      .map((provider) => {
        const own = (channels.data ?? []).filter((c) => c.provider === provider.id);
        const channel =
          own.find((c) => c.status === 'connected') ??
          own.find((c) => c.status === 'needs_reconnect') ??
          own[0];
        return { provider, channel };
      });
  }, [providers.data, channels.data]);

  const isPending = providers.isPending || channels.isPending;
  const isError = providers.isError || channels.isError;
  const hasConnected = (channels.data ?? []).some((c) => c.status !== 'disconnected');

  return (
    <section className="flex flex-col gap-6">
      <Suspense fallback={null}>
        <ConnectResultToaster />
      </Suspense>
      <div>
        <h2 className="text-2xl font-bold tracking-[-0.03em]">{t('title')}</h2>
        <p className="mt-1 max-w-[62ch] text-muted-foreground">{t('description')}</p>
      </div>

      {isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-6">
          <p className="text-sm text-destructive">{t('loadError')}</p>
          <Button
            variant="outline"
            onClick={() => {
              void providers.refetch();
              void channels.refetch();
            }}
          >
            {t('retry')}
          </Button>
        </div>
      ) : (
        <>
          {!hasConnected ? (
            <div className="flex items-start gap-4 rounded-2xl bg-accent p-5 text-accent-foreground">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary">
                <PlugZapIcon aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-lg font-semibold">{t('empty.title')}</h3>
                <p className="mt-1 text-sm">{t('empty.body')}</p>
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            {cards.map(({ provider, channel }) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                channel={channel}
                onDisconnect={setToDisconnect}
              />
            ))}
          </div>
        </>
      )}

      <DisconnectDialog channel={toDisconnect} onClose={() => setToDisconnect(null)} />
    </section>
  );
}
