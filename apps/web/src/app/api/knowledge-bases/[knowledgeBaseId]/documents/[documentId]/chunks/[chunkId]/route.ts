import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string; documentId: string; chunkId: string }>;
}

function upstreamPath(parameters: Awaited<RouteContext['params']>) {
  return `/api/v1/knowledge-bases/${encodeURIComponent(parameters.knowledgeBaseId)}/documents/${encodeURIComponent(parameters.documentId)}/chunks/${encodeURIComponent(parameters.chunkId)}`;
}

export async function PATCH(request: Request, context: RouteContext) {
  const parameters = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(upstreamPath(parameters), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    }),
  );
}

export async function DELETE(_request: Request, context: RouteContext) {
  const parameters = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(upstreamPath(parameters), { method: 'DELETE' }),
  );
}
