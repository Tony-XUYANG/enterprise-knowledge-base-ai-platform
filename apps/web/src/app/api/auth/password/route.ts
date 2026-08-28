import {
  authenticatedApiFetch,
  clearSessionCookies,
  proxyResponse,
} from '@/lib/server-api';

export async function PATCH(request: Request) {
  const upstream = await authenticatedApiFetch('/api/v1/auth/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text(),
  });

  if (upstream.status === 204) await clearSessionCookies();
  return proxyResponse(upstream);
}
