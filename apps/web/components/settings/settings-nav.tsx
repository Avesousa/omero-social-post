'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarClockIcon,
  PlugZapIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TABS: readonly {
  href: string;
  key: 'channels' | 'queue' | 'general';
  icon: LucideIcon;
}[] = [
  { href: '/settings/channels', key: 'channels', icon: PlugZapIcon },
  { href: '/settings/queue', key: 'queue', icon: CalendarClockIcon },
  { href: '/settings/general', key: 'general', icon: SlidersHorizontalIcon },
];

/** Sub-navigation of /settings. Each tab is a route, so every section is linkable. */
export function SettingsNav() {
  const t = useTranslations('Settings.nav');
  const pathname = usePathname();

  return (
    <nav aria-label={t('label')} className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1">
        {TABS.map(({ href, key, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="h-full">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-full items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4',
                  active
                    ? 'bg-card text-foreground shadow-sm dark:border dark:border-input dark:bg-input/40'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className={cn(active && 'text-primary')} />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
