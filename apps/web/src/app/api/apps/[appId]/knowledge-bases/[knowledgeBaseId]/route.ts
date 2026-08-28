import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ appId: string; knowledgeBaseId: string }>;
}

function backendPath(appId: string, knowledgeBaseId: string) {
  return `/api/v1/apps/${encodeURIComponent(appId)}/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`;
}

export async function PUT(_request: Request, context: RouteContext) {
  const { appId, knowledgeBaseId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(backendPath(appId, knowledgeBaseId), { method: 'PUT' }),
  );
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { appId, knowledgeBaseId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(backendPath(appId, knowledgeBaseId), { method: 'DELETE' }),
  );
}
