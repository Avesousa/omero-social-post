import type * as React from 'react';
import { LocaleSwitch } from '@/components/common/locale-switch';
import { ThemeToggle } from '@/components/common/theme-toggle';

/** Shared frame for /setup and /login: a quiet dotted canvas with warm and cool glows. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(var(--input)_1px,transparent_1px)] [background-size:22px_22px] opacity-70 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <div
        aria-hidden="true"
        className="absolute -top-40 -left-32 -z-10 size-[28rem] rounded-full bg-crema/25 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -right-32 -bottom-44 -z-10 size-[30rem] rounded-full bg-lagoon/20 blur-3xl"
      />

      <header className="flex justify-end gap-2 px-4 pt-4 sm:px-6 sm:pt-6">
        <LocaleSwitch />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">{children}</main>
    </div>
  );
}
