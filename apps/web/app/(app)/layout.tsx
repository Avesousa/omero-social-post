import type * as React from 'react';
import { AppShell } from '@/components/shell/app-shell';

// Every route in this group sits behind the session check in `proxy.ts` and renders inside the shell.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
