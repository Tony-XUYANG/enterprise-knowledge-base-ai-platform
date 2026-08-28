import {
  authenticatedApiFetch,
  clearSessionCookies,
  proxyResponse,
} from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const upstream = await authenticatedApiFetch(
    `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );

  if (upstream.ok) {
    const payload = await upstream.clone().json() as {
      data?: { currentSession?: boolean };
    };
    if (payload.data?.currentSession) await clearSessionCookies();
  }
  return proxyResponse(upstream);
}
