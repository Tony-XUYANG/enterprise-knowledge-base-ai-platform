import { authenticatedApiFetch, clientContextHeaders, proxyResponse } from '@/lib/server-api';

export async function POST(request: Request) {
  return proxyResponse(await authenticatedApiFetch('/api/v1/auth/mfa/recovery-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...clientContextHeaders(request) },
    body: await request.text(),
  }));
}
