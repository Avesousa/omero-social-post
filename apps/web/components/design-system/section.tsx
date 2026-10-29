import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Titled block of the design-system page. */
export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('scroll-mt-8', className)}>
      <div className="mb-5 max-w-[60ch]">
        <h2
          id={`${id}-title`}
          className="text-[26px] leading-tight font-semibold tracking-[-0.025em]"
        >
          {title}
        </h2>
        <p className="mt-1 text-[15px] text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** Small heading inside a card. */
export function CardHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{children}</h3>;
}
