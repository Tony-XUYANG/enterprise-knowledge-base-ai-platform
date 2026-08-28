import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string; documentId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { knowledgeBaseId, documentId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      },
    ),
  );
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { knowledgeBaseId, documentId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`,
      { method: 'DELETE' },
    ),
  );
}
