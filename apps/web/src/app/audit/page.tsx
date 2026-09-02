import { redirect } from 'next/navigation';
import { AuditDashboard } from '@/components/audit-dashboard';
import { hasSessionCookie } from '@/lib/server-api';

export default async function AuditPage() {
  if (!(await hasSessionCookie())) redirect('/login');
  return <AuditDashboard />;
}
