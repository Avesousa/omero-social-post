'use client';

import { useTranslations } from 'next-intl';
import { NetworkIcon } from '@/components/brand/network-icon';
import { StatusBadge, StatusDot } from '@/components/common/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { type Network, POST_STATUSES, type PostStatus } from '@/lib/design-tokens';
import { CardHeading, Section } from './section';

// Sample calendar events, one per status.
const events: { status: PostStatus; time: string; network: Network }[] = [
  { status: 'draft', time: '08:30', network: 'linkedin' },
  { status: 'scheduled', time: '09:00', network: 'x' },
  { status: 'publishing', time: '10:15', network: 'linkedin' },
  { status: 'published', time: '12:00', network: 'x' },
  { status: 'partially_published', time: '15:45', network: 'x' },
  { status: 'failed', time: '18:00', network: 'linkedin' },
  { status: 'missed', time: '21:30', network: 'x' },
];

export function StatusesSection() {
  const t = useTranslations('DesignSystem.statuses');
  const ts = useTranslations('Status');
  const th = useTranslations('StatusHint');

  return (
    <Section id="statuses" title={t('title')} description={t('description')}>
      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <ul className="grid divide-y divide-border/70 sm:grid-cols-2 sm:divide-y-0">
            {POST_STATUSES.map((status, index) => (
              <li
                key={status}
                className={`flex items-center gap-4 px-6 py-4 sm:border-b sm:border-border/70 ${
                  index % 2 === 0 ? 'sm:border-r' : ''
                }`}
              >
                <span className="w-[9.5rem] shrink-0">
                  <StatusBadge status={status} />
                </span>
                <p className="text-sm text-muted-foreground">{th(status)}</p>
              </li>
            ))}
          </ul>
          <div className="space-y-3 px-6 py-5">
            <CardHeading>{t('calendarPreview')}</CardHeading>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {events.map(({ status, time, network }) => (
                <li
                  key={status}
                  data-status={status}
                  className="tone-soft flex min-w-0 flex-col gap-1 rounded-md border-l-[3px] px-2.5 py-2 [border-left-color:var(--tone)]"
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold tabular-nums">
                    <StatusDot status={status} />
                    {time}
                    <NetworkIcon network={network} className="ml-auto size-3 opacity-80" />
                  </span>
                  <span className="truncate text-xs font-medium">{ts(status)}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}
