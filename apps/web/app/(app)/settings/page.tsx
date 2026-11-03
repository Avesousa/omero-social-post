import { redirect } from 'next/navigation';

// The settings root has no content of its own: channels are the first tab.
export default function SettingsPage() {
  redirect('/settings/channels');
}
