import { Database } from 'lucide-react';
import Link from 'next/link';

interface BrandProps {
  href?: string;
  compact?: boolean;
}

export function Brand({ href = '/', compact = false }: BrandProps) {
  return (
    <Link className="brand" href={href} aria-label="KnowledgeHub 首页">
      <span className="brandMark" aria-hidden="true">
        <Database size={19} strokeWidth={2.2} />
      </span>
      {!compact && <span>KnowledgeHub</span>}
    </Link>
  );
}
