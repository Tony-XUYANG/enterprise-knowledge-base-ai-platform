import { Check, Circle } from 'lucide-react';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MIN_CHARACTERS,
  type PasswordAssessment,
} from '@/lib/password-policy';

interface PasswordStrengthProps {
  assessment: PasswordAssessment;
  id?: string;
}

const strengthLabels = {
  empty: '未设置',
  weak: '弱',
  medium: '中',
  strong: '强',
  'very-strong': '很强',
} as const;

export function PasswordStrength({ assessment, id }: PasswordStrengthProps) {
  const label = strengthLabels[assessment.strength];
  const validLength = assessment.checks.length && assessment.checks.byteLimit;

  return (
    <div className="passwordPolicy" id={id} aria-live="polite">
      <div className="passwordStrengthHeader">
        <span>密码强度</span>
        <strong>{label}</strong>
      </div>
      <div
        className={`passwordStrengthBar strength-${assessment.strength}`}
        aria-label={`密码强度：${label}`}
      >
        <span /><span /><span /><span />
      </div>
      <ul className="passwordRequirements">
        <li className={validLength ? 'passed' : ''}>
          {validLength ? <Check size={14} /> : <Circle size={12} />}
          {PASSWORD_MIN_CHARACTERS}-{PASSWORD_MAX_CHARACTERS} 个字符且不超过 {PASSWORD_MAX_BYTES} 字节
        </li>
        <li className={assessment.checks.categories ? 'passed' : ''}>
          {assessment.checks.categories ? <Check size={14} /> : <Circle size={12} />}
          大小写字母、数字、符号至少三类
        </li>
        <li className={assessment.checks.unpredictable ? 'passed' : ''}>
          {assessment.checks.unpredictable ? <Check size={14} /> : <Circle size={12} />}
          不使用常见、连续或大量重复字符
        </li>
        <li className={assessment.checks.excludesIdentity ? 'passed' : ''}>
          {assessment.checks.excludesIdentity ? <Check size={14} /> : <Circle size={12} />}
          不包含姓名或邮箱前缀
        </li>
      </ul>
    </div>
  );
}
