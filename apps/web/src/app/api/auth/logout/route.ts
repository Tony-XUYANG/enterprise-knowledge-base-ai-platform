import { logoutSession } from '@/lib/server-api';

export async function POST(request: Request) {
  return logoutSession(request);
}
