import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { knowledgeBaseId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/apps`,
    ),
  );
}
