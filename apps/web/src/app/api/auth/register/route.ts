import { handleAuthentication } from '@/lib/server-api';

export async function POST(request: Request) {
  return handleAuthentication('/register', request);
}
