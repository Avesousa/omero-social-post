import { redirect } from 'next/navigation';

// The calendar is the landing page; the proxy sends visitors without a session to /login first.
export default function HomePage() {
  redirect('/calendar');
}
