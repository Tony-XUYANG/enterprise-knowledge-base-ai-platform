import { redirect } from 'next/navigation';
import { KnowledgeBasesDashboard } from '@/components/knowledge-bases-dashboard';
import { hasSessionCookie } from '@/lib/server-api';

export default async function KnowledgeBasesPage() {
  if (!(await hasSessionCookie())) redirect('/login');
  return <KnowledgeBasesDashboard />;
}
