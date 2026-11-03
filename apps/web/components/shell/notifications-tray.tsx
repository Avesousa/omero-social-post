'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BellIcon,
  CalendarXIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  HourglassIcon,
  Link2OffIcon,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  getNotificationsControllerListQueryKey,
  useNotificationsControllerList,
  useNotificationsControllerRead,
  useNotificationsControllerReadAll,
  type NotificationListDtoOutputItemsItem as Notification,
} from '@omero/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime, useNow } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

/** How often the tray refreshes while the tab is visible. */
const POLL_MS = 30_000;
/** Notifications shown in the tray; the full history gets its own page later. */
const TRAY_LIMIT = 20;

const TYPE_ICON: Record<Notification['type'], LucideIcon> = {
  delivery_failed: CircleAlertIcon,
  channel_reauth: Link2OffIcon,
  token_expiring: HourglassIcon,
  post_missed: CalendarXIcon,
};

const SEVERITY_TONE: Record<Notification['severity'], string> = {
  error: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/15 text-info',
};

/** The API sends in-app paths; anything else (external or protocol-relative) is not linked. */
function safeInternalPath(link: string | null): string | null {
  return link !== null && link.startsWith('/') && !link.startsWith('//') ? link : null;
}

/**
 * Bell with an unread badge and a popover listing the newest notifications.
 * Polls every 30 s while the tab is visible (TanStack Query pauses the interval in
 * background tabs) and refreshes immediately when the tab becomes visible again.
 */
export function NotificationsTray() {
  const t = useTranslations('Notifications');
  const locale = useLocale();
  const now = useNow();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isPending, isError } = useNotificationsControllerList(
    { limit: TRAY_LIMIT },
    {
      query: {
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        staleTime: 0,
      },
    },
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getNotificationsControllerListQueryKey() });
  const markRead = useNotificationsControllerRead({ mutation: { onSuccess: refresh } });
  const markAllRead = useNotificationsControllerReadAll({ mutation: { onSuccess: refresh } });

  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  function openItem(item: Notification) {
    if (item.readAt === null) markRead.mutate({ id: item.id });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative rounded-full"
          aria-label={unread > 0 ? t('triggerWithCount', { count: unread }) : t('trigger')}
        >
          <BellIcon />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-berry px-1 text-[10px] leading-none font-bold text-white ring-2 ring-background tabular-nums"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        className="flex w-[min(400px,calc(100vw-1.5rem))] flex-col gap-0 p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold">{t('title')}</h2>
            {unread > 0 ? (
              <span className="rounded-full bg-berry/15 px-2 py-0.5 text-xs font-bold text-berry tabular-nums">
                {unread}
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheckIcon />
            {t('markAllRead')}
          </Button>
        </div>

        <div className="max-h-[min(420px,60dvh)] overflow-y-auto">
          {isPending ? (
            <div className="flex flex-col gap-3 p-4">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex gap-3">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('error')}</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <BellIcon className="size-5" />
              </span>
              <p className="font-display text-sm font-semibold">{t('emptyTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  when={now === 0 ? '' : formatRelativeTime(item.createdAt, now, locale)}
                  onOpen={() => openItem(item)}
                  onMarkRead={() => markRead.mutate({ id: item.id })}
                />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  item,
  when,
  onOpen,
  onMarkRead,
}: {
  item: Notification;
  when: string;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const t = useTranslations('Notifications');
  const Icon = TYPE_ICON[item.type];
  const href = safeInternalPath(item.link);
  const isUnread = item.readAt === null;

  const content = (
    <>
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          SEVERITY_TONE[item.severity],
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 text-sm leading-snug',
              isUnread ? 'font-semibold' : 'font-medium text-muted-foreground',
            )}
          >
            {item.title}
          </span>
          <time dateTime={item.createdAt} className="shrink-0 text-xs text-muted-foreground">
            {when}
          </time>
        </span>
        {item.body ? (
          <span className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {item.body}
          </span>
        ) : null}
        {href ? (
          <span className="mt-0.5 text-xs font-semibold text-primary">{t('open')}</span>
        ) : null}
      </span>
    </>
  );

  const rowClass = cn(
    'flex flex-1 items-start gap-3 py-3 pr-1 pl-4 text-left outline-none focus-visible:bg-accent/60',
    href && 'hover:bg-accent/40',
  );

  return (
    <li className={cn('flex items-start', isUnread && 'bg-primary/5')}>
      {href ? (
        <Link href={href} onClick={onOpen} className={rowClass}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      <div className="flex w-10 shrink-0 justify-center pt-3.5">
        {isUnread ? (
          <button
            type="button"
            onClick={onMarkRead}
            aria-label={t('markRead')}
            title={t('markRead')}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <CheckIcon className="size-4" />
          </button>
        ) : null}
      </div>
    </li>
  );
}
