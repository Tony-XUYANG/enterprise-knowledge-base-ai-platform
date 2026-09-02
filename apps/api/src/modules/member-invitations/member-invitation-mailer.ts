import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import type { InvitationRole } from './member-invitations.schemas.js';

export interface MemberInvitationMessageInput {
  email: string;
  inviterName: string;
  role: InvitationRole;
  invitationUrl: string;
  expiresInHours: number;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

export function buildMemberInvitationMessage(input: MemberInvitationMessageInput) {
  const inviterName = escapeHtml(input.inviterName);
  const invitationUrl = escapeHtml(input.invitationUrl);
  const roleLabel = input.role === 'admin' ? '管理员' : '普通成员';
  return {
    subject: '你已受邀加入 KnowledgeHub',
    text: [
      `${input.inviterName} 邀请你以${roleLabel}身份加入 KnowledgeHub。`,
      '',
      `请在 ${input.expiresInHours} 小时内打开以下链接创建账号：`,
      input.invitationUrl,
      '',
      '如果你不认识邀请人，请忽略此邮件。',
    ].join('\n'),
    html: `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f4f7f6;font-family:Arial,'Microsoft YaHei',sans-serif;color:#18211f">
    <div style="max-width:560px;margin:0 auto;padding:40px 20px">
      <div style="background:#ffffff;border:1px solid #dbe3e0;padding:32px">
        <div style="font-size:20px;font-weight:700;margin-bottom:24px">KnowledgeHub</div>
        <h1 style="font-size:22px;margin:0 0 16px">加入企业知识库</h1>
        <p style="line-height:1.7;margin:0 0 12px">${inviterName} 邀请你以${roleLabel}身份加入 KnowledgeHub。</p>
        <p style="line-height:1.7;margin:0 0 24px">请在 ${input.expiresInHours} 小时内完成账号创建。</p>
        <a href="${invitationUrl}" style="display:inline-block;background:#147d72;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:700">接受邀请</a>
        <p style="color:#66736f;font-size:13px;line-height:1.6;margin:24px 0 0">该链接只能使用一次。如果你不认识邀请人，请忽略此邮件。</p>
      </div>
    </div>
  </body>
</html>`,
  };
}

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  ...(env.SMTP_USER && env.SMTP_PASSWORD
    ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
    : {}),
  connectionTimeout: 5_000,
  greetingTimeout: 5_000,
  socketTimeout: 10_000,
});

export async function sendMemberInvitationMessage(
  input: MemberInvitationMessageInput,
): Promise<void> {
  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: input.email,
    ...buildMemberInvitationMessage(input),
  });
}
