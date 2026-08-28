import { redirect } from 'next/navigation';
import { ConversationsDashboard } from '@/components/conversations-dashboard';
import { hasSessionCookie } from '@/lib/server-api';

export default async function ConversationsPage() {
  if (!(await hasSessionCookie())) redirect('/login');
  return <ConversationsDashboard />;
}
