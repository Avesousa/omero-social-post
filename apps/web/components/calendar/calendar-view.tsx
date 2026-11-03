'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import esLocale from '@fullcalendar/core/locales/es';
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg } from '@fullcalendar/core';
import { DateTime } from 'luxon';
import {
  isApiError,
  schedulingControllerSchedule,
  usePostsControllerList,
  useSettingsControllerGet,
  type PostListDtoOutputItemsItem,
} from '@omero/api-client';
import { Skeleton } from '@/components/ui/skeleton';
import { type Network, type PostStatus } from '@/lib/design-tokens';
import './calendar.css';
import { DraftsPanel } from './drafts-panel';
import { EventCard, type CalendarEventData } from './event-card';
import { CalendarToolbar, type CalendarViewName } from './toolbar';
import { formatTime, isValidZone, wallClockToUtc, withDefaultTime } from './time';

const POSTS_KEY = '/api/v1/posts';
/** Only scheduled posts can be dragged; the others are read-only on the grid. */
const DRAGGABLE: ReadonlySet<PostStatus> = new Set(['scheduled']);
const OPENS_COMPOSER: ReadonlySet<PostStatus> = new Set(['draft', 'scheduled']);

function toNetworks(post: PostListDtoOutputItemsItem): Network[] {
  const set = new Set<Network>(post.deliveries.map((d) => d.provider));
  return [...set];
}

/** The calendar screen: toolbar, FullCalendar grid, drag-to-reschedule with undo, drafts list. */
export function CalendarView() {
  const t = useTranslations('Calendar');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const calendarRef = useRef<FullCalendar>(null);
  const settings = useSettingsControllerGet();
  const zone = isValidZone(settings.data?.timezone) ? settings.data.timezone : 'UTC';

  const [view, setView] = useState<CalendarViewName>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'timeGridDay' : 'timeGridWeek',
  );
  const [title, setTitle] = useState('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  // The grid never spans more than 6 weeks (42 days), well inside the API's 62-day cap.
  const list = usePostsControllerList(range ?? { from: '', to: '' }, {
    query: {
      enabled: range !== null,
      placeholderData: keepPreviousData,
      refetchInterval: 30_000,
    },
  });

  const events = useMemo(
    () =>
      (list.data?.items ?? []).flatMap((post) => {
        const at = post.publishedAt ?? post.scheduledAt;
        if (!at) return [];
        const data: CalendarEventData = {
          status: post.status,
          preview: post.preview,
          networks: toNetworks(post),
          needsAttention: post.deliveries.some((d) => d.needsAttention),
          time: formatTime(at, zone, locale),
          isPublishedTime: post.publishedAt !== null,
        };
        return [
          {
            id: post.id,
            start: at,
            editable: DRAGGABLE.has(post.status),
            extendedProps: { post, data },
          },
        ];
      }),
    [list.data, zone, locale],
  );

  const onDatesSet = useCallback(
    (arg: DatesSetArg) => {
      setTitle(arg.view.title);
      const from = wallClockToUtc(arg.startStr.slice(0, 19), zone);
      const to = wallClockToUtc(arg.endStr.slice(0, 19), zone);
      setRange((previous) =>
        previous?.from === from && previous.to === to ? previous : { from, to },
      );
    },
    [zone],
  );

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [POSTS_KEY] }),
    [queryClient],
  );

  async function onEventDrop(arg: EventDropArg) {
    const post = arg.event.extendedProps.post as PostListDtoOutputItemsItem;
    const previousAt = post.scheduledAt;
    const nextWall = arg.event.startStr.slice(0, 19);
    const nextAt = wallClockToUtc(nextWall, zone);
    if (!previousAt || DateTime.fromISO(nextAt).toMillis() < Date.now()) {
      arg.revert();
      toast.error(t('drop.past'));
      return;
    }
    try {
      const updated = await schedulingControllerSchedule(post.id, {
        at: nextAt,
        version: post.version,
      });
      void refetch();
      toast.success(t('drop.moved'), {
        action: {
          label: t('drop.undo'),
          onClick: () => {
            schedulingControllerSchedule(post.id, { at: previousAt, version: updated.version })
              .then(() => toast.success(t('drop.undone')))
              .catch(() => toast.error(t('drop.undoFailed')))
              .finally(() => void refetch());
          },
        },
      });
    } catch (error) {
      arg.revert();
      if (isApiError(error) && error.status === 422) toast.error(t('drop.past'));
      else if (isApiError(error) && error.status === 409) {
        toast.error(t('drop.conflict'));
        void refetch();
      } else toast.error(t('drop.failed'));
    }
  }

  function onEventClick(arg: EventClickArg) {
    const post = arg.event.extendedProps.post as PostListDtoOutputItemsItem;
    router.push(OPENS_COMPOSER.has(post.status) ? `/posts/${post.id}/edit` : `/posts/${post.id}`);
  }

  function onDateClick(info: { dateStr: string }) {
    const wall = withDefaultTime(info.dateStr.slice(0, 19));
    const at = wallClockToUtc(wall, zone);
    if (DateTime.fromISO(at).toMillis() < Date.now()) {
      toast.error(t('click.past'));
      return;
    }
    router.push(`/posts/new?scheduledAt=${encodeURIComponent(at)}`);
  }

  function renderEvent(arg: EventContentArg) {
    return (
      <EventCard
        data={arg.event.extendedProps.data as CalendarEventData}
        compact={arg.view.type === 'dayGridMonth'}
      />
    );
  }

  if (!settings.data) {
    return <Skeleton className="h-[640px] rounded-2xl" aria-busy="true" />;
  }

  const api = () => calendarRef.current?.getApi();

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
      <section className="flex min-w-0 flex-col gap-4">
        <CalendarToolbar
          title={title}
          view={view}
          onPrev={() => api()?.prev()}
          onNext={() => api()?.next()}
          onToday={() => api()?.today()}
          onView={(next) => {
            setView(next);
            api()?.changeView(next);
          }}
        />
        <div
          className="omero-calendar rounded-2xl border border-border/70 bg-card p-2 shadow-sm sm:p-3"
          aria-busy={list.isFetching}
        >
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
            initialView={view}
            headerToolbar={false}
            timeZone={zone}
            locales={[esLocale]}
            locale={locale}
            firstDay={1}
            nowIndicator
            allDaySlot={false}
            height="auto"
            dayMaxEvents={3}
            slotMinTime="06:00:00"
            slotMaxTime="24:00:00"
            scrollTime="08:00:00"
            slotEventOverlap={false}
            defaultTimedEventDuration="00:45:00"
            events={events}
            eventContent={renderEvent}
            eventDisplay="block"
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            datesSet={onDatesSet}
            eventClick={onEventClick}
            dateClick={onDateClick}
            eventDrop={(arg) => void onEventDrop(arg)}
            editable
            eventStartEditable
            eventDurationEditable={false}
          />
        </div>
        {list.isError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t('loadError')}
          </p>
        ) : null}
      </section>
      <DraftsPanel />
    </div>
  );
}
