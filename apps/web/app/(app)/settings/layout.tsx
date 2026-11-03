import type * as React from 'react';
import { SettingsNav } from '@/components/settings/settings-nav';

/** Settings frame: the Canales / Cola / General tabs above whichever section is open. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav />
      {children}
    </div>
  );
}
