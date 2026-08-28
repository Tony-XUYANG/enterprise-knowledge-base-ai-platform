import { redirect } from 'next/navigation';
import { AppsDashboard } from '@/components/apps-dashboard';
import { hasSessionCookie } from '@/lib/server-api';

export default async function AppsPage() {
  if (!(await hasSessionCookie())) redirect('/login');
  return <AppsDashboard />;
}
