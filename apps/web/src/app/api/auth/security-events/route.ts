import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get('limit') ?? '20';
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/auth/security-events?limit=${encodeURIComponent(limit)}`,
    ),
  );
}
