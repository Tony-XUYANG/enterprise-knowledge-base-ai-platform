import { query } from '../../db/pool.js';

interface OverviewSummaryRow {
  apps: number;
  active_apps: number;
  knowledge_bases: number;
  ready_knowledge_bases: number;
  conversations: number;
  active_conversations: number;
  messages: number;
  bindings: number;
  bound_apps: number;
  bound_knowledge_bases: number;
}

interface OverviewActivityRow {
  day: string;
  conversations: number;
  messages: number;
}

interface OverviewRecentRow {
  id: string;
  type: 'app' | 'knowledge_base' | 'conversation';
  title: string;
  subtitle: string | null;
  status: string;
  occurred_at: Date;
}

export interface OverviewData {
  summary: {
    apps: number;
    activeApps: number;
    knowledgeBases: number;
    readyKnowledgeBases: number;
    conversations: number;
    activeConversations: number;
    messages: number;
    bindings: number;
    boundApps: number;
    boundKnowledgeBases: number;
  };
  activity: Array<{
    day: string;
    conversations: number;
    messages: number;
  }>;
  recent: Array<{
    id: string;
    type: 'app' | 'knowledge_base' | 'conversation';
    title: string;
    subtitle: string | null;
    status: string;
    occurredAt: string;
  }>;
}

export async function getOverview(ownerId: string): Promise<OverviewData> {
  const [summaryResult, activityResult, recentResult] = await Promise.all([
    query<OverviewSummaryRow>(
      `SELECT
         (SELECT count(*)::int FROM ai_apps WHERE owner_id = $1) AS apps,
         (SELECT count(*)::int FROM ai_apps WHERE owner_id = $1 AND status = 'active') AS active_apps,
         (SELECT count(*)::int FROM knowledge_bases WHERE owner_id = $1) AS knowledge_bases,
         (SELECT count(*)::int FROM knowledge_bases WHERE owner_id = $1 AND status = 'ready') AS ready_knowledge_bases,
         (SELECT count(*)::int FROM conversations WHERE user_id = $1) AS conversations,
         (SELECT count(*)::int FROM conversations WHERE user_id = $1 AND status = 'active') AS active_conversations,
         (
           SELECT count(*)::int
             FROM messages message
             JOIN conversations conversation ON conversation.id = message.conversation_id
            WHERE conversation.user_id = $1
         ) AS messages,
         (SELECT count(*)::int FROM app_knowledge_bases WHERE owner_id = $1) AS bindings,
         (SELECT count(DISTINCT app_id)::int FROM app_knowledge_bases WHERE owner_id = $1) AS bound_apps,
         (SELECT count(DISTINCT knowledge_base_id)::int FROM app_knowledge_bases WHERE owner_id = $1) AS bound_knowledge_bases`,
      [ownerId],
    ),
    query<OverviewActivityRow>(
      `WITH days AS (
         SELECT generate_series(
           CURRENT_DATE - INTERVAL '6 days',
           CURRENT_DATE,
           INTERVAL '1 day'
         )::date AS day
       )
       SELECT to_char(day, 'YYYY-MM-DD') AS day,
              (
                SELECT count(*)::int
                  FROM conversations conversation
                 WHERE conversation.user_id = $1
                   AND conversation.created_at >= day
                   AND conversation.created_at < day + 1
              ) AS conversations,
              (
                SELECT count(*)::int
                  FROM messages message
                  JOIN conversations conversation
                    ON conversation.id = message.conversation_id
                 WHERE conversation.user_id = $1
                   AND message.created_at >= day
                   AND message.created_at < day + 1
              ) AS messages
         FROM days
        ORDER BY day`,
      [ownerId],
    ),
    query<OverviewRecentRow>(
      `SELECT *
         FROM (
           SELECT app.id, 'app'::varchar AS type, app.name AS title,
                  app.description AS subtitle, app.status, app.updated_at AS occurred_at
             FROM ai_apps app
            WHERE app.owner_id = $1
           UNION ALL
           SELECT kb.id, 'knowledge_base'::varchar AS type, kb.name AS title,
                  kb.description AS subtitle, kb.status, kb.updated_at AS occurred_at
             FROM knowledge_bases kb
            WHERE kb.owner_id = $1
           UNION ALL
           SELECT conversation.id, 'conversation'::varchar AS type,
                  conversation.title, app.name AS subtitle,
                  conversation.status, conversation.updated_at AS occurred_at
             FROM conversations conversation
             JOIN ai_apps app ON app.id = conversation.app_id
            WHERE conversation.user_id = $1
         ) recent_item
        ORDER BY occurred_at DESC, id DESC
        LIMIT 8`,
      [ownerId],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    apps: 0,
    active_apps: 0,
    knowledge_bases: 0,
    ready_knowledge_bases: 0,
    conversations: 0,
    active_conversations: 0,
    messages: 0,
    bindings: 0,
    bound_apps: 0,
    bound_knowledge_bases: 0,
  };

  return {
    summary: {
      apps: summary.apps,
      activeApps: summary.active_apps,
      knowledgeBases: summary.knowledge_bases,
      readyKnowledgeBases: summary.ready_knowledge_bases,
      conversations: summary.conversations,
      activeConversations: summary.active_conversations,
      messages: summary.messages,
      bindings: summary.bindings,
      boundApps: summary.bound_apps,
      boundKnowledgeBases: summary.bound_knowledge_bases,
    },
    activity: activityResult.rows,
    recent: recentResult.rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      status: row.status,
      occurredAt: row.occurred_at.toISOString(),
    })),
  };
}
