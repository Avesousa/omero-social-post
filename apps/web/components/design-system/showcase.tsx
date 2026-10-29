'use client';

import { useState } from 'react';
import { MenuIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LocaleSwitch } from '@/components/common/locale-switch';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ComponentsSection } from './components-section';
import { Hero } from './hero';
import { NetworksSection } from './networks-section';
import { PaletteSection } from './palette-section';
import { ShowcaseNav } from './showcase-nav';
import { StatusesSection } from './statuses-section';
import { TypeSection } from './type-section';

/** Design-system placeholder page: espresso sidebar + main column with every token group. */
export function DesignSystemShowcase() {
  const t = useTranslations('DesignSystem.header');
  const tc = useTranslations('Common');
  const tn = useTranslations('Nav');
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="hidden bg-sidebar lg:block">
        <div className="sticky top-0 h-dvh overflow-y-auto">
          <ShowcaseNav />
        </div>
      </aside>

      <div id="top" className="min-w-0">
        <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-6 sm:px-8 lg:px-10 lg:pt-8">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="rounded-full lg:hidden"
                aria-label={tc('openMenu')}
              >
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              closeLabel={tc('close')}
              className="w-[280px] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">{tn('label')}</SheetTitle>
              <ShowcaseNav onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
              {t('title')}
            </h1>
            <p className="hidden truncate text-sm text-muted-foreground sm:block">
              {t('subtitle')}
            </p>
          </div>

          <LocaleSwitch />
          <ThemeToggle />
        </header>

        <main className="mx-auto flex max-w-6xl flex-col gap-14 px-4 pt-6 pb-20 sm:px-8 lg:px-10 lg:pt-8">
          <Hero />
          <PaletteSection />
          <StatusesSection />
          <NetworksSection />
          <ComponentsSection />
          <TypeSection />
        </main>
      </div>
    </div>
  );
}
