import {
  authenticatedApiFetch,
  clearSessionCookies,
  proxyResponse,
} from '@/lib/server-api';

export async function GET() {
  return proxyResponse(await authenticatedApiFetch('/api/v1/auth/sessions'));
}

export async function DELETE() {
  const upstream = await authenticatedApiFetch('/api/v1/auth/sessions', {
    method: 'DELETE',
  });

  if (upstream.ok) await clearSessionCookies();
  return proxyResponse(upstream);
}
