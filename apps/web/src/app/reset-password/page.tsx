import { PasswordResetConfirmForm } from '@/components/password-reset-confirm-form';

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token = '' } = await searchParams;
  return <PasswordResetConfirmForm token={token} />;
}
