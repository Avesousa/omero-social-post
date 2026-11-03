'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDaysIcon, Settings2Icon, SquarePenIcon, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LogoMark } from '@/components/brand/logo';
import { LocaleSwitch } from '@/components/common/locale-switch';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  labelKey: 'calendar' | 'newPost' | 'settings';
  icon: LucideIcon;
  /** Active on this exact path only (the composer's edit routes must not light up "Nuevo post"). */
  exact?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/calendar', labelKey: 'calendar', icon: CalendarDaysIcon },
  { href: '/posts/new', labelKey: 'newPost', icon: SquarePenIcon, exact: true },
  { href: '/settings', labelKey: 'settings', icon: Settings2Icon },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Espresso sidebar content, shared by the desktop aside and the mobile sheet. */
export function SidebarNav({
  onNavigate,
  showPreferences = false,
}: {
  onNavigate?: () => void;
  /** Mobile only: the top bar hides the locale and theme toggles, so the sheet offers them. */
  showPreferences?: boolean;
}) {
  const t = useTranslations('Nav');
  const tc = useTranslations('Common');
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-8 px-4 py-6 text-sidebar-foreground">
      <Link
        href="/calendar"
        onClick={onNavigate}
        className="flex items-center gap-2.5 rounded-md px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-primary/50"
      >
        <LogoMark className="size-9" />
        <span className="font-display text-[24px] leading-none font-bold tracking-[-0.035em]">
          {tc('appName')}
        </span>
      </Link>

      <nav aria-label={t('label')} className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-primary/50',
                active
                  ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:top-2 before:bottom-2 before:-left-4 before:w-1 before:rounded-r-full before:bg-sidebar-primary'
                  : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}
            >
              <Icon className={cn('size-[18px]', active && 'text-sidebar-primary')} />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-4">
        {showPreferences ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-sidebar-border p-3">
            <LocaleSwitch />
            <ThemeToggle />
          </div>
        ) : null}
        <p className="flex items-center gap-2 px-2 text-xs text-sidebar-muted">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
          {t('instance')}
        </p>
      </div>
    </div>
  );
}
