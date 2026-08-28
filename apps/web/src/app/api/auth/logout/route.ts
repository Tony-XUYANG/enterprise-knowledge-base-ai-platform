import { logoutSession } from '@/lib/server-api';

export async function POST() {
  return logoutSession();
}
