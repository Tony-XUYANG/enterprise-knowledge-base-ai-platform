import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string; documentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { knowledgeBaseId, documentId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/content/preview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      },
    ),
  );
}
