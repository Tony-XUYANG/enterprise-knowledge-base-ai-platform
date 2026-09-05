import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ appId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { appId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/access-keys`,
    ),
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { appId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/access-keys`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      },
    ),
  );
}
