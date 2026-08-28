import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyResponse(
    await authenticatedApiFetch(`/api/v1/knowledge-bases${url.search}`),
  );
}

export async function POST(request: Request) {
  return proxyResponse(
    await authenticatedApiFetch('/api/v1/knowledge-bases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    }),
  );
}
