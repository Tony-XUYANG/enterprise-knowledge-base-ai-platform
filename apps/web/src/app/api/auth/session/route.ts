import {
  authenticatedApiFetch,
  clientContextHeaders,
  proxyResponse,
} from '@/lib/server-api';

export async function GET() {
  return proxyResponse(await authenticatedApiFetch('/api/v1/auth/me'));
}

export async function PATCH(request: Request) {
  return proxyResponse(
    await authenticatedApiFetch('/api/v1/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...clientContextHeaders(request),
      },
      body: await request.text(),
    }),
  );
}
