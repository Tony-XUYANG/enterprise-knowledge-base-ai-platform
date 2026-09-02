import { authenticatedApiFetch, proxyResponse } from '@/lib/server-api';

interface RouteContext {
  params: Promise<{ invitationId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { invitationId } = await context.params;
  return proxyResponse(
    await authenticatedApiFetch(
      `/api/v1/admin/invitations/${encodeURIComponent(invitationId)}/resend`,
      { method: 'POST' },
    ),
  );
}
