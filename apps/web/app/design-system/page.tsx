import type { Metadata } from 'next';
import { DesignSystemShowcase } from '@/components/design-system/showcase';

export const metadata: Metadata = { title: 'Design system' };

// Reference page for the design tokens and shared components. Not linked from the app nav.
export default function DesignSystemPage() {
  return <DesignSystemShowcase />;
}
