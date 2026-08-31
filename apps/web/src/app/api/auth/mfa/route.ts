import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

export async function GET() {
  return proxyResponse(await authenticatedApiFetch('/api/v1/auth/mfa'));
}
