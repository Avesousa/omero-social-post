import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

/** Stand-in for screens that a later task builds (calendar, settings). */
export function PlaceholderPage({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Icon className="size-7" />
      </span>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">{title}</h2>
      <p className="max-w-[46ch] text-muted-foreground">{body}</p>
      {children}
    </section>
  );
}
