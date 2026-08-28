import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ appId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { appId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(`/api/v1/apps/${encodeURIComponent(appId)}`),
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { appId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(`/api/v1/apps/${encodeURIComponent(appId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    }),
  );
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { appId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(`/api/v1/apps/${encodeURIComponent(appId)}`, {
      method: 'DELETE',
    }),
  );
}
