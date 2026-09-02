import {
  authenticatedApiFetch,
  proxyDownloadResponse,
} from '@/lib/server-api';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyDownloadResponse(
    await authenticatedApiFetch(`/api/v1/admin/audit-events/export${url.search}`),
  );
}
