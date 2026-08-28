import { redirect } from 'next/navigation';
import { KnowledgeBaseDocumentsDashboard } from '@/components/knowledge-base-documents-dashboard';
import { hasSessionCookie } from '@/lib/server-api';

interface KnowledgeBaseDocumentsPageProps {
  params: Promise<{ knowledgeBaseId: string }>;
}

export default async function KnowledgeBaseDocumentsPage({
  params,
}: KnowledgeBaseDocumentsPageProps) {
  if (!(await hasSessionCookie())) redirect('/login');
  const { knowledgeBaseId } = await params;
  return <KnowledgeBaseDocumentsDashboard knowledgeBaseId={knowledgeBaseId} />;
}
