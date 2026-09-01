import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { userId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    }),
  );
}
