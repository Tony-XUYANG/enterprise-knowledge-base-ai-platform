import type { SecurityEvent } from './types';

export const securityEventTypeLabels: Record<SecurityEvent['eventType'], string> = {
  account_registered: '账号创建',
  login_succeeded: '登录成功',
  login_failed: '登录失败',
  account_locked: '账号锁定',
  account_unlocked: '账号解锁',
  profile_updated: '资料更新',
  password_changed: '密码更新',
  password_reset_requested: '请求密码重置',
  password_reset_completed: '完成密码重置',
  refresh_token_reused: '会话令牌重放',
  session_revoked: '设备会话退出',
  all_sessions_revoked: '全部会话退出',
  logout: '主动退出',
  mfa_setup_started: '开始设置 MFA',
  mfa_enabled: '启用 MFA',
  mfa_disabled: '关闭 MFA',
  mfa_recovery_codes_regenerated: '更新恢复码',
  mfa_login_failed: 'MFA 验证失败',
  email_verification_requested: '发送验证邮件',
  email_verified: '邮箱验证完成',
  user_role_changed: '成员角色变更',
  user_status_changed: '成员状态变更',
  member_invitation_sent: '成员邀请发送',
  member_invitation_revoked: '成员邀请撤销',
  member_invitation_accepted: '成员接受邀请',
};

export function describeSecurityEvent(
  event: Pick<SecurityEvent, 'eventType' | 'outcome' | 'metadata'>,
) {
  switch (event.eventType) {
    case 'account_registered':
      return { title: '账号已创建', detail: '企业账号注册完成' };
    case 'login_succeeded':
      return { title: '登录成功', detail: '已建立新的设备会话' };
    case 'login_failed':
      return {
        title: '登录失败',
        detail: event.metadata.reason === 'account_disabled'
          ? '已拦截停用账号的登录尝试'
          : event.metadata.reason === 'account_locked'
            ? '临时锁定期间拦截了新的登录尝试'
            : event.metadata.reason === 'email_not_verified'
              ? '邮箱尚未验证，未建立登录会话'
              : '已拦截凭据错误的登录尝试',
      };
    case 'account_locked':
      return { title: '账号已临时锁定', detail: '连续登录失败达到保护上限' };
    case 'account_unlocked':
      return { title: '账号锁定已解除', detail: '临时保护期结束，已恢复登录' };
    case 'profile_updated':
      return { title: '个人资料已更新', detail: '账号显示信息发生变更' };
    case 'password_changed':
      return { title: '密码已更新', detail: '所有设备会话已同步失效' };
    case 'password_reset_requested':
      return { title: '已请求密码重置', detail: '系统已受理一次性密码重置请求' };
    case 'password_reset_completed':
      return { title: '密码重置完成', detail: '密码已更新，所有设备会话已失效' };
    case 'refresh_token_reused':
      return { title: '检测到会话令牌重放', detail: '疑似会话凭据泄露，已自动撤销该设备' };
    case 'session_revoked':
      return { title: '设备会话已退出', detail: '已撤销指定设备的访问权限' };
    case 'all_sessions_revoked':
      return { title: '所有设备已退出', detail: '已撤销账号的全部活跃会话' };
    case 'logout':
      return { title: '已主动退出', detail: '当前设备会话已结束' };
    case 'mfa_setup_started':
      return { title: '开始设置双重验证', detail: '已创建一次性验证器配置' };
    case 'mfa_enabled':
      return { title: '双重验证已启用', detail: '账号登录已增加第二步身份验证' };
    case 'mfa_disabled':
      return { title: '双重验证已关闭', detail: '账号已恢复为密码登录' };
    case 'mfa_recovery_codes_regenerated':
      return { title: '恢复码已更新', detail: '旧恢复码已全部失效' };
    case 'mfa_login_failed':
      return { title: '双重验证失败', detail: '已拦截无效或过期的第二步验证' };
    case 'email_verification_requested':
      return { title: '已发送验证邮件', detail: '已创建一次性邮箱验证链接' };
    case 'email_verified':
      return { title: '邮箱验证完成', detail: '登录邮箱已确认并激活' };
    case 'user_role_changed':
      return {
        title: '账号角色已调整',
        detail: event.metadata.role === 'admin'
          ? '管理员已授予账号管理权限，原有设备会话已失效'
          : '管理员已将账号调整为普通成员，原有设备会话已失效',
      };
    case 'user_status_changed':
      return {
        title: event.metadata.status === 'disabled' ? '账号已被停用' : '账号已重新启用',
        detail: event.metadata.status === 'disabled'
          ? '管理员已停用账号并撤销全部设备会话'
          : '管理员已恢复账号登录权限',
      };
    case 'member_invitation_sent':
      return {
        title: event.outcome === 'failure' ? '邀请邮件发送失败' : '成员邀请已发送',
        detail: event.outcome === 'failure'
          ? '邀请链接已自动失效，可以重新创建邀请'
          : event.metadata.action === 'resent'
            ? '已生成新链接并作废原邀请链接'
            : '已向成员邮箱发送一次性邀请链接',
      };
    case 'member_invitation_revoked':
      return { title: '成员邀请已撤销', detail: '原邀请链接已立即失效' };
    case 'member_invitation_accepted':
      return { title: '已接受成员邀请', detail: '邮箱已确认，账号创建完成' };
  }
}
