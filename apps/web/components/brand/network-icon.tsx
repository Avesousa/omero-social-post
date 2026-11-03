import type * as React from 'react';
import { type Network } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

// Simple network glyphs (24x24, currentColor) used only to identify each network.

function XGlyph() {
  return (
    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  );
}

function LinkedInGlyph() {
  return (
    <>
      <circle cx="5" cy="4.6" r="2.2" />
      <path d="M3.2 8h3.6v13H3.2z" />
      <path d="M9.2 8h3.4v1.8c.6-1.1 2-2.1 4.1-2.1 3.6 0 5 2.2 5 5.8V21h-3.6v-6.8c0-1.7-.5-3-2.2-3-1.9 0-3.1 1.3-3.1 3.3V21H9.2z" />
    </>
  );
}

function InstagramGlyph() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.3" />
      <circle cx="17.6" cy="6.4" r="0.6" fill="currentColor" />
    </g>
  );
}

function FacebookGlyph() {
  return (
    <path d="M13.6 22v-8.2h2.8l.4-3.3h-3.2V8.4c0-.9.3-1.6 1.6-1.6H17V3.9a22 22 0 0 0-2.5-.1c-2.5 0-4.2 1.5-4.2 4.3v2.4H7.5v3.3h2.8V22z" />
  );
}

const glyphs: Record<Network, () => React.JSX.Element> = {
  x: XGlyph,
  linkedin: LinkedInGlyph,
  instagram: InstagramGlyph,
  facebook: FacebookGlyph,
};

export function NetworkIcon({ network, className }: { network: Network; className?: string }) {
  const Glyph = glyphs[network];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn('size-4 shrink-0', className)}
    >
      <Glyph />
    </svg>
  );
}
