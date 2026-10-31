import type * as React from 'react';
import { LogoMark } from '@/components/brand/logo';

/** Centered card used by the setup and login screens: brand mark, headline, then the form. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-[420px]">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-lg">
        <div className="relative flex flex-col items-center gap-4 bg-espresso px-8 pt-9 pb-8 text-center text-sidebar-foreground dark:bg-sidebar">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.08)_1px,transparent_1px)] [background-size:16px_16px]"
          />
          <LogoMark className="relative size-14 drop-shadow-[0_6px_14px_rgb(0_0_0/0.35)]" />
          <div className="relative flex flex-col gap-1.5">
            <h1 className="text-[26px] leading-tight font-bold tracking-[-0.03em]">{title}</h1>
            <p className="text-sm text-sidebar-muted">{subtitle}</p>
          </div>
        </div>
        <div className="px-8 py-7">{children}</div>
      </div>
      {footer ? <p className="mt-5 text-center text-xs text-muted-foreground">{footer}</p> : null}
    </div>
  );
}
