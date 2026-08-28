import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
    ),
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      },
    ),
  );
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' },
    ),
  );
}
