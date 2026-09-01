import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';

export interface EmailVerificationMessageInput {
  email: string;
  displayName: string;
  verificationUrl: string;
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

export function buildEmailVerificationMessage(input: EmailVerificationMessageInput) {
  const displayName = escapeHtml(input.displayName);
  const verificationUrl = escapeHtml(input.verificationUrl);
  return {
    subject: '验证你的 KnowledgeHub 邮箱',
    text: [
      `${input.displayName}，你好：`,
      '',
      `请在 ${input.expiresInHours} 小时内打开以下链接完成邮箱验证：`,
      input.verificationUrl,
      '',
      '如果这不是你的操作，请忽略此邮件。',
    ].join('\n'),
    html: `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f4f7f6;font-family:Arial,'Microsoft YaHei',sans-serif;color:#18211f">
    <div style="max-width:560px;margin:0 auto;padding:40px 20px">
      <div style="background:#ffffff;border:1px solid #dbe3e0;padding:32px">
        <div style="font-size:20px;font-weight:700;margin-bottom:24px">KnowledgeHub</div>
        <h1 style="font-size:22px;margin:0 0 16px">验证邮箱</h1>
        <p style="line-height:1.7;margin:0 0 12px">${displayName}，你好：</p>
        <p style="line-height:1.7;margin:0 0 24px">请在 ${input.expiresInHours} 小时内完成邮箱验证。</p>
        <a href="${verificationUrl}" style="display:inline-block;background:#147d72;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:700">验证邮箱</a>
        <p style="color:#66736f;font-size:13px;line-height:1.6;margin:24px 0 0">如果这不是你的操作，请忽略此邮件。该链接只能使用一次。</p>
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

export async function sendEmailVerificationMessage(
  input: EmailVerificationMessageInput,
): Promise<void> {
  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: input.email,
    ...buildEmailVerificationMessage(input),
  });
}
