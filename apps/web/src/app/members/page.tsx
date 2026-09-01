import { redirect } from 'next/navigation';
import { MembersDashboard } from '@/components/members-dashboard';
import { hasSessionCookie } from '@/lib/server-api';

export default async function MembersPage() {
  if (!(await hasSessionCookie())) redirect('/login');
  return <MembersDashboard />;
}
