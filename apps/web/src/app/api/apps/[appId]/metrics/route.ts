import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ appId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { appId } = await context.params;
  const range = new URL(request.url).searchParams.get('range');
  const query = range ? `?range=${encodeURIComponent(range)}` : '';
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/metrics${query}`,
    ),
  );
}
