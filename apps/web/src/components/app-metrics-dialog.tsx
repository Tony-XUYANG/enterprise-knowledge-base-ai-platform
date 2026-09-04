'use client';

import {
  Bot,
  ChartNoAxesCombined,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { AiApp, AppMetrics, AppMetricsRange } from '@/lib/types';

const rangeOptions: Array<{ value: AppMetricsRange; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
];

const numberFormatter = new Intl.NumberFormat('zh-CN');

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatLatency(value: number): string {
  if (value <= 0) return '--';
  if (value >= 1000) return `${(value / 1000).toFixed(1)} 秒`;
  return `${value} ms`;
}

function dayLabel(value: string): string {
  return value.slice(5).replace('-', '/');
}

function showDayLabel(index: number, total: number): boolean {
  if (total <= 7) return true;
  const interval = total <= 30 ? 5 : 15;
  return index === 0 || index === total - 1 || index % interval === 0;
}

export function AppMetricsDialog({
  open,
  app,
  range,
  metrics,
  loading,
  error,
  onRangeChange,
  onRetry,
  onClose,
}: {
  open: boolean;
  app: AiApp | null;
  range: AppMetricsRange;
  metrics: AppMetrics | null;
  loading: boolean;
  error: string;
  onRangeChange: (range: AppMetricsRange) => void;
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

  const activityMax = useMemo(
    () => Math.max(1, ...(metrics?.activity.flatMap((item) => [
      item.conversations,
      item.messages,
    ]) ?? [])),
    [metrics],
  );

  if (!open || !app) return null;

  const summary = metrics?.summary;
  const metricItems = summary ? [
    {
      label: '新增会话',
      value: formatNumber(summary.conversations),
      detail: `${formatNumber(summary.userMessages)} 条用户消息`,
      icon: MessageSquareText,
    },
    {
      label: '消息总量',
      value: formatNumber(summary.totalMessages),
      detail: `${formatNumber(summary.assistantMessages)} 条助手回复`,
      icon: Bot,
    },
    {
      label: '回复成功率',
      value: `${summary.successRate}%`,
      detail: `${summary.completedReplies} 成功 / ${summary.failedReplies} 失败`,
      icon: Zap,
    },
    {
      label: 'Token 用量',
      value: formatNumber(summary.totalTokens),
      detail: `${formatNumber(summary.promptTokens)} 输入 / ${formatNumber(summary.completionTokens)} 输出`,
      icon: ChartNoAxesCombined,
    },
    {
      label: '平均响应',
      value: formatLatency(summary.averageLatencyMs),
      detail: '仅统计已完成回复',
      icon: Clock3,
    },
    {
      label: '待处理回复',
      value: formatNumber(summary.pendingReplies),
      detail: summary.pendingReplies > 0 ? '仍有生成任务运行' : '当前没有积压',
      icon: CircleAlert,
    },
  ] : [];

  const maximumModelReplies = Math.max(1, ...(metrics?.models.map((item) => item.replies) ?? []));

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialogPanel appMetricsDialog" role="dialog" aria-modal="true" aria-labelledby="app-metrics-title">
        <header className="dialogHeader appMetricsHeader">
          <div className="dialogTitleWithIcon">
            <span className="appMetricsTitleIcon" aria-hidden="true"><ChartNoAxesCombined size={18} /></span>
            <span>
              <h2 id="app-metrics-title">应用分析</h2>
              <small>{app.name}</small>
            </span>
          </div>
          <div className="appMetricsHeaderActions">
            <div className="segmentedControl compactSegments" aria-label="分析时间范围">
              {rangeOptions.map((option) => (
                <button
                  className={range === option.value ? 'selected' : ''}
                  key={option.value}
                  type="button"
                  onClick={() => onRangeChange(option.value)}
                  aria-pressed={range === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button className="iconButton" type="button" onClick={onClose} aria-label="关闭" title="关闭">
              <X size={19} />
            </button>
          </div>
        </header>

        {loading && !metrics ? (
          <div className="appMetricsLoading"><LoaderCircle className="spin" size={21} />正在汇总应用数据</div>
        ) : error && !metrics ? (
          <div className="appMetricsError" role="alert">
            <CircleAlert size={20} />
            <span>{error}</span>
            <button className="secondaryButton" type="button" onClick={onRetry}>
              <RefreshCw size={16} />重试
            </button>
          </div>
        ) : metrics ? (
          <div className="appMetricsBody" aria-busy={loading}>
            {error && (
              <div className="errorBanner appMetricsInlineError" role="alert">
                <span>{error}</span>
                <button className="textButton" type="button" onClick={onRetry}><RefreshCw size={15} />重试</button>
              </div>
            )}

            <section className="appMetricsSummary" aria-label="核心指标">
              {metricItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div className="appMetricItem" key={item.label}>
                    <span aria-hidden="true"><Icon size={16} /></span>
                    <small>{item.label}</small>
                    <strong>{item.value}</strong>
                    <em>{item.detail}</em>
                  </div>
                );
              })}
            </section>

            <section className="appMetricsSection" aria-labelledby="app-activity-title">
              <header className="appMetricsSectionHeader">
                <div>
                  <h3 id="app-activity-title">每日活跃趋势</h3>
                  <span>{metrics.fromDate.replaceAll('-', '.')} - {metrics.toDate.replaceAll('-', '.')}</span>
                </div>
                <span className="appMetricsLegend">
                  <span><i className="appConversationLegend" />新增会话</span>
                  <span><i className="appMessageLegend" />消息</span>
                </span>
              </header>
              <div className="appMetricsChartScroller">
                <div className={`appMetricsChart appMetricsChart-${range}`}>
                  {metrics.activity.map((item, index) => (
                    <div className="appMetricsDay" key={item.day}>
                      <div className="appMetricsBars">
                        <i
                          className="appConversationBar"
                          style={{ height: item.conversations === 0 ? '0' : `${Math.max(3, (item.conversations / activityMax) * 100)}%` }}
                          title={`${dayLabel(item.day)} 新增会话 ${item.conversations}`}
                        />
                        <i
                          className="appMessageBar"
                          style={{ height: item.messages === 0 ? '0' : `${Math.max(3, (item.messages / activityMax) * 100)}%` }}
                          title={`${dayLabel(item.day)} 消息 ${item.messages}，助手回复 ${item.assistantReplies}`}
                        />
                        {item.failedReplies > 0 && (
                          <b title={`${dayLabel(item.day)} 失败回复 ${item.failedReplies}`} aria-label={`${dayLabel(item.day)} 失败回复 ${item.failedReplies}`} />
                        )}
                      </div>
                      <span className={showDayLabel(index, metrics.activity.length) ? '' : 'hiddenDayLabel'}>
                        {dayLabel(item.day)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="appMetricsSection modelMetricsSection" aria-labelledby="model-metrics-title">
              <header className="appMetricsSectionHeader">
                <div>
                  <h3 id="model-metrics-title">模型使用分布</h3>
                  <span>{metrics.models.length} 个模型记录</span>
                </div>
              </header>
              {metrics.models.length === 0 ? (
                <div className="modelMetricsEmpty">所选时间范围内暂无助手回复</div>
              ) : (
                <div className="modelMetricsTable">
                  <div className="modelMetricsTableHeader" role="row">
                    <span>模型</span><span>回复</span><span>成功率</span><span>Token</span><span>平均响应</span>
                  </div>
                  {metrics.models.map((item) => (
                    <div className="modelMetricsRow" role="row" key={item.model}>
                      <div className="modelIdentity">
                        <strong>{item.model}</strong>
                        <span className="modelUsageTrack"><span style={{ width: `${(item.replies / maximumModelReplies) * 100}%` }} /></span>
                      </div>
                      <span><b>{item.replies}</b><small>回复</small></span>
                      <span className={item.failedReplies > 0 ? 'modelSuccessWithFailure' : ''}>
                        <b>{item.successRate}%</b><small>{item.failedReplies} 失败 / {item.pendingReplies} 待处理</small>
                      </span>
                      <span><b>{formatNumber(item.totalTokens)}</b><small>{formatNumber(item.promptTokens)} / {formatNumber(item.completionTokens)}</small></span>
                      <span><b>{formatLatency(item.averageLatencyMs)}</b><small>{item.completedReplies} 次完成</small></span>
                    </div>
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
