import { redirect } from 'next/navigation';
import { hasSessionCookie } from '@/lib/server-api';

export default async function HomePage() {
  redirect((await hasSessionCookie()) ? '/overview' : '/login');
}
