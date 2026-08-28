import { redirect } from 'next/navigation';
import { AccountSecurity } from '@/components/account-security';
import { hasSessionCookie } from '@/lib/server-api';

export default async function SettingsPage() {
  if (!(await hasSessionCookie())) redirect('/login');
  return <AccountSecurity />;
}
