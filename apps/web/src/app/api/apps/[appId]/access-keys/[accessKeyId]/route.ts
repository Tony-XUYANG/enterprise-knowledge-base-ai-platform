import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ appId: string; accessKeyId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { appId, accessKeyId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/access-keys/${encodeURIComponent(accessKeyId)}`,
      { method: 'DELETE' },
    ),
  );
}
