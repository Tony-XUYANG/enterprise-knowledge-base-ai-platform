import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ appId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { appId } = await context.params;
  const url = new URL(request.url);
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/external-requests${url.search}`,
    ),
  );
}
