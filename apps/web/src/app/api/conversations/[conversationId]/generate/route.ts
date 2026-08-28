import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      },
    ),
  );
}
