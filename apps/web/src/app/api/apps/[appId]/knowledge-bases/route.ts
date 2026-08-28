import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ appId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { appId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/knowledge-bases`,
    ),
  );
}
