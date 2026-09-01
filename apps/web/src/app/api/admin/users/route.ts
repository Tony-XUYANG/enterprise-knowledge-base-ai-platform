import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyResponse(
    await authenticatedApiFetch(`/api/v1/admin/users${url.search}`),
  );
}
