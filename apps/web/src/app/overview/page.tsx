import { redirect } from 'next/navigation';
import { OverviewDashboard } from '@/components/overview-dashboard';
import { hasSessionCookie } from '@/lib/server-api';

export default async function OverviewPage() {
  if (!(await hasSessionCookie())) redirect('/login');
  return <OverviewDashboard />;
}
