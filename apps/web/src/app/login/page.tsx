import { AuthForm } from '@/components/auth-form';

interface LoginPageProps {
  searchParams: Promise<{
    passwordChanged?: string;
    passwordReset?: string;
    sessionsRevoked?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { passwordChanged, passwordReset, sessionsRevoked } = await searchParams;
  const successMessage = passwordChanged === '1'
    ? '密码已更新，请使用新密码登录'
    : passwordReset === '1'
      ? '密码已重置，请使用新密码登录'
    : sessionsRevoked === '1'
      ? '所有设备均已退出，请重新登录'
      : undefined;
  return (
    <AuthForm
      mode="login"
      successMessage={successMessage}
    />
  );
}
