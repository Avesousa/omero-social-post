'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MenuIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type * as React from 'react';
import { LocaleSwitch } from '@/components/common/locale-switch';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { NotificationsTray } from './notifications-tray';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

type TitleKey = 'calendar' | 'newPost' | 'editPost' | 'settings' | 'post';

/** Page title for the top bar, from the route. Each page owns its own content below it. */
function titleKeyFor(pathname: string): TitleKey {
  if (pathname.startsWith('/calendar')) return 'calendar';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname === '/posts/new') return 'newPost';
  if (/^\/posts\/[^/]+\/edit$/.test(pathname)) return 'editPost';
  return 'post';
}

/**
 * Authenticated frame: espresso sidebar on desktop (a sheet on mobile) plus a sticky top bar
 * with the page title, notifications, locale and theme toggles, and the user menu.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Shell');
  const tc = useTranslations('Common');
  const tn = useTranslations('Nav');
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="hidden bg-sidebar lg:block">
        <div className="sticky top-0 h-dvh overflow-y-auto">
          <SidebarNav />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full lg:hidden"
            aria-label={tc('openMenu')}
            onClick={() => setMenuOpen(true)}
          >
            <MenuIcon />
          </Button>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetContent
              side="left"
              closeLabel={tc('close')}
              className="w-[280px] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">{tn('label')}</SheetTitle>
              <SheetDescription className="sr-only">{t('menuDescription')}</SheetDescription>
              <SidebarNav onNavigate={() => setMenuOpen(false)} showPreferences />
            </SheetContent>
          </Sheet>

          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
            {t(`titles.${titleKeyFor(pathname)}`)}
          </h1>

          <div className="flex items-center gap-2">
            <NotificationsTray />
            <div className="hidden items-center gap-2 sm:flex">
              <LocaleSwitch />
              <ThemeToggle />
            </div>
            <UserMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
