import { proxyResponse, publicApiFetch } from '@/lib/server-api';

export async function POST(request: Request) {
  return proxyResponse(
    await publicApiFetch('/api/v1/auth/password-reset/request', request),
  );
}
