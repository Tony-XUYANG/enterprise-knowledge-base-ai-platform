import { describe, expect, it } from 'vitest';
import { buildMemberInvitationMessage } from '../src/modules/member-invitations/member-invitation-mailer.js';

describe('member invitation mailer', () => {
  it('builds readable text and escapes dynamic HTML content', () => {
    const message = buildMemberInvitationMessage({
      email: 'invitee@example.com',
      inviterName: '<Admin & Owner>',
      role: 'admin',
      invitationUrl: 'https://example.com/accept?token=a&next=<home>',
      expiresInHours: 72,
    });

    expect(message.subject).toContain('KnowledgeHub');
    expect(message.text).toContain('<Admin & Owner>');
    expect(message.text).toContain('管理员');
    expect(message.text).toContain('72 小时');
    expect(message.html).toContain('&lt;Admin &amp; Owner&gt;');
    expect(message.html).toContain('token=a&amp;next=&lt;home&gt;');
    expect(message.html).not.toContain('<Admin & Owner>');
  });
});
