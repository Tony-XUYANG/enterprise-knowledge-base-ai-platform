import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { knowledgeBaseId } = await context.params;
  const url = new URL(request.url);
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents${url.search}`,
    ),
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { knowledgeBaseId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      },
    ),
  );
}
