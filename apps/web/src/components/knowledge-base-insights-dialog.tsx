'use client';

import {
  Boxes,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileText,
  FileUp,
  Globe2,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Type,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import type {
  KnowledgeBase,
  KnowledgeBaseInsightIssue,
  KnowledgeBaseInsights,
  KnowledgeDocumentSourceType,
  KnowledgeDocumentStatus,
} from '@/lib/types';

const statusLabels: Record<KnowledgeDocumentStatus, string> = {
  ready: '就绪',
  processing: '处理中',
  pending: '待处理',
  failed: '失败',
  disabled: '已停用',
};

const sourceConfig: Record<KnowledgeDocumentSourceType, {
  label: string;
  icon: typeof FileText;
}> = {
  file: { label: '文件', icon: FileText },
  url: { label: '网页', icon: Globe2 },
  text: { label: '文本', icon: Type },
};

const issueConfig: Record<KnowledgeBaseInsightIssue, {
  label: string;
  tone: string;
}> = {
  failed: { label: '解析失败', tone: 'danger' },
  stalled: { label: '处理超过 24 小时', tone: 'warning' },
  empty: { label: '就绪但无分块', tone: 'warning' },
  unsynced: { label: '未同步 Collection', tone: 'muted' },
};

const numberFormatter = new Intl.NumberFormat('zh-CN');

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${formatNumber(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function KnowledgeBaseInsightsDialog({
  open,
  knowledgeBase,
  insights,
  loading,
  error,
  onRetry,
  onClose,
}: {
  open: boolean;
  knowledgeBase: KnowledgeBase | null;
  insights: KnowledgeBaseInsights | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open || !knowledgeBase) return null;

  const summary = insights?.summary;
  const summaryItems = summary ? [
    {
      label: '活跃文档',
      value: formatNumber(summary.activeDocuments),
      detail: `共 ${summary.totalDocuments} 个，${summary.disabledDocuments} 个已停用`,
      icon: FileText,
      tone: '',
    },
    {
      label: '内容就绪率',
      value: `${summary.readinessRate}%`,
      detail: `${summary.readyDocuments} 个文档已就绪`,
      icon: CircleCheck,
      tone: summary.readinessRate === 100 ? 'positive' : 'warning',
    },
    {
      label: '正文覆盖率',
      value: `${summary.contentCoverageRate}%`,
      detail: `${summary.contentDocuments} 个文档包含分块`,
      icon: Boxes,
      tone: summary.contentCoverageRate === 100 ? 'positive' : 'warning',
    },
    {
      label: '同步覆盖率',
      value: `${summary.syncCoverageRate}%`,
      detail: `${summary.syncedDocuments} 个文档已关联 Collection`,
      icon: Link2,
      tone: summary.syncCoverageRate === 100 ? 'positive' : 'warning',
    },
    {
      label: '有效分块',
      value: formatNumber(summary.totalChunks),
      detail: `平均 ${summary.averageChunksPerDocument} 个 / 文档`,
      icon: FileUp,
      tone: '',
    },
    {
      label: '待处理问题',
      value: formatNumber(summary.issueDocuments),
      detail: summary.issueDocuments === 0 ? '当前内容状态正常' : '请优先处理下方文档',
      icon: summary.issueDocuments === 0 ? ShieldCheck : TriangleAlert,
      tone: summary.issueDocuments === 0 ? 'positive' : 'danger',
    },
  ] : [];

  const maximumStatusDocuments = Math.max(
    1,
    ...(insights?.statuses.map((item) => item.documents) ?? []),
  );

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialogPanel knowledgeInsightsDialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-insights-title">
        <header className="dialogHeader knowledgeInsightsHeader">
          <div className="dialogTitleWithIcon">
            <span className="knowledgeInsightsTitleIcon" aria-hidden="true"><ShieldCheck size={18} /></span>
            <span>
              <h2 id="knowledge-insights-title">内容健康</h2>
              <small>{knowledgeBase.name}</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        {loading && !insights ? (
          <div className="knowledgeInsightsLoading"><LoaderCircle className="spin" size={21} />正在分析知识库内容</div>
        ) : error && !insights ? (
          <div className="knowledgeInsightsError" role="alert">
            <CircleAlert size={20} />
            <span>{error}</span>
            <button className="secondaryButton" type="button" onClick={onRetry}>
              <RefreshCw size={16} />重试
            </button>
          </div>
        ) : insights ? (
          <div className="knowledgeInsightsBody" aria-busy={loading}>
            {error && (
              <div className="errorBanner knowledgeInsightsInlineError" role="alert">
                <span>{error}</span>
                <button className="textButton" type="button" onClick={onRetry}><RefreshCw size={15} />重试</button>
              </div>
            )}

            <section className="knowledgeInsightsSummary" aria-label="内容健康指标">
              {summaryItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div className={`knowledgeInsightMetric ${item.tone ? `knowledgeInsightMetric-${item.tone}` : ''}`} key={item.label}>
                    <span aria-hidden="true"><Icon size={16} /></span>
                    <small>{item.label}</small>
                    <strong>{item.value}</strong>
                    <em>{item.detail}</em>
                  </div>
                );
              })}
            </section>

            <div className="knowledgeInsightsBreakdown">
              <section className="knowledgeInsightsSection" aria-labelledby="knowledge-status-title">
                <header>
                  <h3 id="knowledge-status-title">文档状态</h3>
                  <span>{summary?.totalDocuments ?? 0} 个文档</span>
                </header>
                {insights.statuses.length === 0 ? (
                  <div className="knowledgeInsightsEmpty">暂无文档</div>
                ) : (
                  <div className="knowledgeStatusList">
                    {insights.statuses.map((item) => (
                      <div className="knowledgeStatusItem" key={item.status}>
                        <span><i className={`knowledgeStatusDot knowledgeStatusDot-${item.status}`} />{statusLabels[item.status]}</span>
                        <span className="knowledgeStatusTrack"><span style={{ width: `${(item.documents / maximumStatusDocuments) * 100}%` }} /></span>
                        <b>{item.documents}</b>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="knowledgeInsightsSection knowledgeSourceSection" aria-labelledby="knowledge-source-title">
                <header>
                  <h3 id="knowledge-source-title">来源分布</h3>
                  <span>仅统计活跃文档</span>
                </header>
                {insights.sources.length === 0 ? (
                  <div className="knowledgeInsightsEmpty">暂无活跃来源</div>
                ) : (
                  <div className="knowledgeSourceList">
                    {insights.sources.map((item) => {
                      const source = sourceConfig[item.sourceType];
                      const SourceIcon = source.icon;
                      return (
                        <div className="knowledgeSourceItem" key={item.sourceType}>
                          <span aria-hidden="true"><SourceIcon size={15} /></span>
                          <strong>{source.label}</strong>
                          <span>{item.documents} 文档</span>
                          <span>{item.chunks} 分块</span>
                          <small>{formatBytes(item.totalBytes)}</small>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <section className="knowledgeChunkQuality" aria-labelledby="chunk-quality-title">
              <header>
                <div>
                  <h3 id="chunk-quality-title">分块质量</h3>
                  <span>{formatBytes(summary?.totalBytes ?? 0)} 活跃内容</span>
                </div>
              </header>
              <div>
                <span><small>平均字符</small><strong>{formatNumber(insights.chunkQuality.averageCharacters)}</strong></span>
                <span><small>字符范围</small><strong>{formatNumber(insights.chunkQuality.minimumCharacters)} - {formatNumber(insights.chunkQuality.maximumCharacters)}</strong></span>
                <span><small>Token 标注</small><strong>{insights.chunkQuality.tokenCoverageRate}%</strong></span>
                <span><small>平均 Token</small><strong>{formatNumber(insights.chunkQuality.averageTokens)}</strong></span>
              </div>
            </section>

            <section className="knowledgeIssuesSection" aria-labelledby="knowledge-issues-title">
              <header>
                <div>
                  <h3 id="knowledge-issues-title">需要处理</h3>
                  <span>最多显示 8 个优先项</span>
                </div>
                <b>{summary?.issueDocuments ?? 0}</b>
              </header>
              {insights.issues.length === 0 ? (
                <div className="knowledgeIssuesEmpty"><CheckCircle2 size={20} />没有检测到内容问题</div>
              ) : (
                <div className="knowledgeIssuesList">
                  {insights.issues.map((issue) => (
                    <article className="knowledgeIssueRow" key={issue.documentId}>
                      <span className="knowledgeIssueIcon" aria-hidden="true">
                        {issue.reasons.includes('failed') ? <CircleAlert size={17} /> : issue.reasons.includes('stalled') ? <Clock3 size={17} /> : <TriangleAlert size={17} />}
                      </span>
                      <span className="knowledgeIssueIdentity">
                        <strong>{issue.name}</strong>
                        <small>{issue.errorMessage || `${sourceConfig[issue.sourceType].label}来源 · ${issue.chunkCount} 个分块 · 更新于 ${formatDate(issue.updatedAt)}`}</small>
                      </span>
                      <span className="knowledgeIssueReasons">
                        {issue.reasons.map((reason) => (
                          <em className={`knowledgeIssueTag knowledgeIssueTag-${issueConfig[reason].tone}`} key={reason}>{issueConfig[reason].label}</em>
                        ))}
                      </span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}
