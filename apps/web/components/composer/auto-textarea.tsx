'use client';

import { useLayoutEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** Textarea that grows with its content (no inner scrollbar) and re-measures when its width changes. */
export function AutoTextarea({
  value,
  className,
  minRows = 3,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, 'rows'> & { value: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      element.style.height = 'auto';
      // +2 covers the 1px borders so the last line never clips.
      element.style.height = `${element.scrollHeight + 2}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    let lastWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === lastWidth) return;
      lastWidth = element.clientWidth;
      fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);

  return (
    <Textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={cn('resize-none overflow-hidden leading-relaxed', className)}
      {...props}
    />
  );
}
