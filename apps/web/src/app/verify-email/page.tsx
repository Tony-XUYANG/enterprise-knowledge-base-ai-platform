import { EmailVerificationForm } from '@/components/email-verification-form';

interface VerifyEmailPageProps {
  searchParams: Promise<{
    token?: string;
    email?: string;
    registered?: string;
  }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token = '', email = '', registered } = await searchParams;
  return (
    <EmailVerificationForm
      token={token}
      initialEmail={email}
      registered={registered === '1'}
    />
  );
}
