import { InvitationAcceptanceForm } from '@/components/invitation-acceptance-form';

interface AcceptInvitationPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitationPage({ searchParams }: AcceptInvitationPageProps) {
  const { token = '' } = await searchParams;
  return <InvitationAcceptanceForm token={token} />;
}
