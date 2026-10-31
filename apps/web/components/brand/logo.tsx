import { cn } from '@/lib/utils';

/**
 * omero mark: a cup of coffee seen from above, a crema ring around an espresso "o".
 * Original artwork for this project.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8 shrink-0', className)}>
      <circle cx="16" cy="16" r="15" fill="var(--crema)" />
      <circle cx="16" cy="16" r="8.5" fill="var(--espresso)" />
      <path
        d="M11.3 13.4a5.6 5.6 0 0 1 4.4-3.2"
        fill="none"
        stroke="var(--crema)"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx="25.2" cy="8.4" r="2.2" fill="var(--lagoon)" />
    </svg>
  );
}

export function Logo({ className, label = 'omero' }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="font-display text-[22px] leading-none font-bold tracking-[-0.03em]">
        {label}
      </span>
    </span>
  );
}
