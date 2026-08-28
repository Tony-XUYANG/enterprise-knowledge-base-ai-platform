import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyResponse(
    await authenticatedApiFetch(`/api/v1/conversations${url.search}`),
  );
}

export async function POST(request: Request) {
  return proxyResponse(
    await authenticatedApiFetch('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    }),
  );
}
