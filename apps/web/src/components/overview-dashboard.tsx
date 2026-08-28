'use client';

import {
  AppWindow,
  BookOpenText,
  ChevronRight,
  CircleCheck,
  DatabaseZap,
  Link2,
  MessageSquareText,
  MessagesSquare,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type { OverviewData } from '@/lib/types';
import { WorkspaceShell } from './workspace-shell';
import { WorkspaceStats } from './workspace-stats';

const initialOverview: OverviewData = {
  summary: {
    apps: 0,
    activeApps: 0,
    knowledgeBases: 0,
    readyKnowledgeBases: 0,
    conversations: 0,
    activeConversations: 0,
    messages: 0,
    bindings: 0,
    boundApps: 0,
    boundKnowledgeBases: 0,
  },
  activity: [],
  recent: [],
};

const recentTypeConfig = {
  app: { label: 'AI 应用', href: '/apps', icon: AppWindow, tone: 'app' },
  knowledge_base: {
    label: '知识库',
    href: '/knowledge-bases',
    icon: BookOpenText,
    tone: 'knowledge',
  },
  conversation: {
    label: '对话',
    href: '/conversations',
    icon: MessageSquareText,
    tone: 'conversation',
  },
} as const;

const statusLabels: Record<string, string> = {
  active: '进行中',
  draft: '草稿',
  disabled: '已停用',
  ready: '就绪',
  pending: '待处理',
  failed: '失败',
  archived: '已归档',
};

const statusTones: Record<string, 'positive' | 'warning' | 'danger' | 'muted'> = {
  active: 'positive',
  ready: 'positive',
  draft: 'warning',
  pending: 'warning',
  failed: 'danger',
  disabled: 'muted',
  archived: 'muted',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatActivityDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return {
    date: value.slice(5).replace('-', '/'),
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date),
  };
}

export function OverviewDashboard() {
  const router = useRouter();
  const [data, setData] = useState<OverviewData>(initialOverview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await clientApi<OverviewData>('/api/overview'));
    } catch (requestError) {
      if (requestError instanceof ClientApiError && requestError.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '总览加载失败，请稍后重试',
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const activityMax = useMemo(
    () => Math.max(1, ...data.activity.flatMap((item) => [item.conversations, item.messages])),
    [data.activity],
  );

  const healthItems = [
    {
      label: '启用应用',
      value: data.summary.activeApps,
      total: data.summary.apps,
      href: '/apps',
    },
    {
      label: '就绪知识库',
      value: data.summary.readyKnowledgeBases,
      total: data.summary.knowledgeBases,
      href: '/knowledge-bases',
    },
    {
      label: '已关联应用',
      value: data.summary.boundApps,
      total: data.summary.apps,
      href: '/apps',
    },
    {
      label: '已关联知识库',
      value: data.summary.boundKnowledgeBases,
      total: data.summary.knowledgeBases,
      href: '/knowledge-bases',
    },
  ];

  return (
    <WorkspaceShell active="overview" title="总览">
      <section className="workspaceHeader">
        <div className="pageTitle">
          <h1>总览</h1>
        </div>
        <button className="iconButton overviewRefresh" type="button" onClick={() => void loadOverview()} disabled={loading} aria-label="刷新总览" title="刷新总览">
          <RefreshCw className={loading ? 'spin' : ''} size={18} />
        </button>
      </section>

      <WorkspaceStats
        label="平台概况"
        items={[
          { label: 'AI 应用', value: data.summary.apps, icon: AppWindow },
          { label: '知识库', value: data.summary.knowledgeBases, icon: BookOpenText },
          { label: '对话', value: data.summary.conversations, icon: MessageSquareText },
          { label: '消息', value: data.summary.messages, icon: MessagesSquare },
        ]}
      />

      {error && (
        <div className="errorBanner" role="alert">
          <span>{error}</span>
          <button className="textButton" type="button" onClick={() => void loadOverview()}>
            <RefreshCw size={16} />重试
          </button>
        </div>
      )}

      <div className="overviewMain" aria-busy={loading}>
        <section className="overviewSection" aria-labelledby="activity-title">
          <header className="overviewSectionHeader">
            <div>
              <h2 id="activity-title">近 7 天活跃</h2>
              <span className="overviewLegend">
                <span><i className="legendConversation" />新增对话</span>
                <span><i className="legendMessage" />消息</span>
              </span>
            </div>
          </header>

          <div className="activityChart" aria-label="近 7 天对话和消息数量">
            {data.activity.map((item) => {
              const label = formatActivityDay(item.day);
              return (
                <div className="activityDay" key={item.day}>
                  <div className="activityBars">
                    <span
                      className="activityBar activityConversationBar"
                      style={{ height: `${Math.max(4, (item.conversations / activityMax) * 100)}%` }}
                      title={`${label.date} 新增对话 ${item.conversations}`}
                      aria-label={`${label.date} 新增对话 ${item.conversations}`}
                    />
                    <span
                      className="activityBar activityMessageBar"
                      style={{ height: `${Math.max(4, (item.messages / activityMax) * 100)}%` }}
                      title={`${label.date} 消息 ${item.messages}`}
                      aria-label={`${label.date} 消息 ${item.messages}`}
                    />
                  </div>
                  <span><strong>{label.weekday}</strong><small>{label.date}</small></span>
                </div>
              );
            })}
            {loading && data.activity.length === 0 && <div className="overviewChartLoading">正在汇总</div>}
          </div>
        </section>

        <section className="overviewSection overviewHealthSection" aria-labelledby="health-title">
          <header className="overviewSectionHeader">
            <div>
              <h2 id="health-title">资源覆盖</h2>
              <span>{data.summary.bindings} 条应用知识库关联</span>
            </div>
          </header>
          <div className="healthList">
            {healthItems.map((item) => {
              const percentage = item.total === 0 ? 0 : Math.round((item.value / item.total) * 100);
              return (
                <Link className="healthItem" href={item.href} key={item.label}>
                  <span className="healthLabel">
                    <strong>{item.label}</strong>
                    <small>{item.value} / {item.total}</small>
                  </span>
                  <span className="healthTrack" aria-label={`${item.label} ${percentage}%`}>
                    <span style={{ width: `${percentage}%` }} />
                  </span>
                  <b>{percentage}%</b>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <section className="dataSurface recentSurface" aria-labelledby="recent-title">
        <header className="recentHeader">
          <div>
            <h2 id="recent-title">最近动态</h2>
            <span>按更新时间排序</span>
          </div>
          <DatabaseZap size={18} aria-hidden="true" />
        </header>

        {loading && data.recent.length === 0 ? (
          <div className="recentLoading">正在加载动态</div>
        ) : data.recent.length === 0 ? (
          <div className="recentEmpty">暂无资源动态</div>
        ) : (
          <div className="recentList">
            {data.recent.map((item) => {
              const config = recentTypeConfig[item.type];
              const Icon = config.icon;
              const statusTone = statusTones[item.status] ?? 'muted';
              const itemStatusLabel = item.type === 'app' && item.status === 'active'
                ? '已启用'
                : statusLabels[item.status] ?? item.status;
              return (
                <Link className="recentRow" href={config.href} key={`${item.type}-${item.id}`}>
                  <span className={`recentIcon recentIcon-${config.tone}`} aria-hidden="true"><Icon size={17} /></span>
                  <span className="recentIdentity">
                    <strong>{item.title}</strong>
                    <small>{item.subtitle || '暂无补充信息'}</small>
                  </span>
                  <span className="recentMeta">
                    <span className="recentType">{config.label}</span>
                    <span className={`overviewStatus overviewStatus-${statusTone}`}>{itemStatusLabel}</span>
                    <time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
                  </span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </WorkspaceShell>
  );
}
