import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ conversationId: string; messageId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { conversationId, messageId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/retry`,
      { method: 'POST' },
    ),
  );
}
