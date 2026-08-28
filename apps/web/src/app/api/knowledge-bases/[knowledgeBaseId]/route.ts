import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { knowledgeBaseId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
    ),
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { knowledgeBaseId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      },
    ),
  );
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { knowledgeBaseId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
      { method: 'DELETE' },
    ),
  );
}
