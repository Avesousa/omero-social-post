'use client';

import { CalendarDaysIcon, PaletteIcon, Settings2Icon, SquarePenIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { LogoMark } from '@/components/brand/logo';
import { NetworkAvatar } from '@/components/common/network-badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export const SECTION_IDS = ['palette', 'statuses', 'networks', 'components', 'type'] as const;

/**
 * Sidebar content for the design-system page (desktop aside and mobile sheet).
 * The real app shell is built in a later task; this shows how the espresso sidebar looks.
 */
export function ShowcaseNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('Nav');
  const tc = useTranslations('Common');
  const tds = useTranslations('DesignSystem');

  const sectionLabels: Record<(typeof SECTION_IDS)[number], string> = {
    palette: tds('palette.title'),
    statuses: tds('statuses.title'),
    networks: tds('networks.title'),
    components: tds('components.title'),
    type: tds('type.title'),
  };

  const upcoming = [
    { key: 'calendar', label: t('calendar'), icon: CalendarDaysIcon },
    { key: 'newPost', label: t('newPost'), icon: SquarePenIcon },
    { key: 'settings', label: t('settings'), icon: Settings2Icon },
  ];

  return (
    <div className="flex h-full flex-col gap-8 px-4 py-6 text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-2">
        <LogoMark className="size-9" />
        <span className="font-display text-[24px] leading-none font-bold tracking-[-0.035em]">
          {tc('appName')}
        </span>
      </div>

      <nav aria-label={t('label')} className="flex flex-col gap-1">
        <a
          href="#top"
          aria-current="page"
          onClick={onNavigate}
          className="relative flex h-10 items-center gap-3 rounded-md bg-sidebar-accent px-3 text-sm font-semibold text-sidebar-accent-foreground before:absolute before:top-2 before:bottom-2 before:-left-4 before:w-1 before:rounded-r-full before:bg-sidebar-primary"
        >
          <PaletteIcon className="size-[18px] text-sidebar-primary" />
          {t('designSystem')}
        </a>
        {upcoming.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => toast(tc('comingSoon'), { description: label })}
            className="flex h-10 items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-sidebar-muted transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-primary/50"
          >
            <Icon className="size-[18px]" />
            {label}
          </button>
        ))}
      </nav>

      <div>
        <p className="mb-2 px-3 text-xs font-semibold text-sidebar-muted">{t('onThisPage')}</p>
        <ul className="flex flex-col">
          {SECTION_IDS.map((id) => (
            <li key={id}>
              <a
                href={`#${id}`}
                onClick={onNavigate}
                className="flex h-8 items-center rounded-md px-3 text-[13px] text-sidebar-muted transition-colors outline-none hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-primary/50"
              >
                {sectionLabels[id]}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto flex items-center gap-3 rounded-lg border border-sidebar-border p-3">
        <Avatar className="size-9">
          <AvatarFallback className="bg-crema text-xs font-bold text-espresso">OD</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tds('samplePost.author')}</p>
          <p className="truncate text-xs text-sidebar-muted">{t('instance')}</p>
        </div>
        <div className={cn('flex -space-x-1.5')}>
          <NetworkAvatar network="x" className="size-5 ring-2 ring-sidebar" />
          <NetworkAvatar network="linkedin" className="size-5 ring-2 ring-sidebar" />
        </div>
      </div>
    </div>
  );
}
