import { handleMfaVerification } from '@/lib/server-api';

export async function POST(request: Request) {
  return handleMfaVerification(request);
}
