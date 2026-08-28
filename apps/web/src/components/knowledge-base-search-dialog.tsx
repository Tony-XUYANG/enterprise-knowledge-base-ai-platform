'use client';

import { FileText, LoaderCircle, Search, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type { KnowledgeBaseSearchResult } from '@/lib/types';

interface KnowledgeBaseSearchDialogProps {
  open: boolean;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  onClose: () => void;
}

function formatDuration(durationMs: number) {
  return durationMs < 1 ? '<1 ms' : `${durationMs.toFixed(durationMs < 10 ? 1 : 0)} ms`;
}

export function KnowledgeBaseSearchDialog({
  open,
  knowledgeBaseId,
  knowledgeBaseName,
  onClose,
}: KnowledgeBaseSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [minScore, setMinScore] = useState(15);
  const [limit, setLimit] = useState(8);
  const [result, setResult] = useState<KnowledgeBaseSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMinScore(15);
    setLimit(8);
    setResult(null);
    setError('');
  }, [knowledgeBaseId, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !searching) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, searching]);

  if (!open) return null;

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setError('');
    try {
      setResult(
        await clientApi<KnowledgeBaseSearchResult>(
          `/api/knowledge-bases/${knowledgeBaseId}/search`,
          {
            method: 'POST',
            body: JSON.stringify({ query, limit, minScore: minScore / 100 }),
          },
        ),
      );
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '检索失败，请稍后重试',
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !searching) onClose();
    }}>
      <section className="dialogPanel retrievalDialog" role="dialog" aria-modal="true" aria-labelledby="retrieval-title">
        <header className="dialogHeader">
          <div className="dialogTitleWithIcon">
            <span className="relationTitleIcon" aria-hidden="true"><Search size={19} /></span>
            <span>
              <h2 id="retrieval-title">检索测试</h2>
              <small>{knowledgeBaseName}</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} disabled={searching} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        <form className="retrievalForm" onSubmit={submitSearch}>
          <div className="retrievalQueryRow">
            <label className="searchBox">
              <Search size={17} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} placeholder="输入问题或关键词" aria-label="检索内容" autoFocus required />
            </label>
            <button className="primaryButton" type="submit" disabled={searching || !query.trim()}>
              {searching ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
              {searching ? '检索中' : '开始检索'}
            </button>
          </div>
          <div className="retrievalOptions">
            <label className="retrievalThreshold">
              <span>最低相关度 <strong>{minScore}%</strong></span>
              <input type="range" min={5} max={80} step={5} value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} />
            </label>
            <label className="field compactField">
              <span>返回数量</span>
              <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                <option value={5}>5 条</option>
                <option value={8}>8 条</option>
                <option value={12}>12 条</option>
                <option value={20}>20 条</option>
              </select>
            </label>
          </div>
        </form>

        {error && <div className="retrievalError formError" role="alert">{error}</div>}

        <div className="retrievalResults" aria-busy={searching}>
          {searching ? (
            <div className="retrievalEmpty"><LoaderCircle className="spin" size={21} />正在检索</div>
          ) : !result ? (
            <div className="retrievalEmpty"><Search size={22} />等待检索</div>
          ) : result.items.length === 0 ? (
            <div className="retrievalEmpty"><Search size={22} />没有达到相关度阈值的分块</div>
          ) : (
            <>
              <header className="retrievalSummary">
                <strong>{result.items.length} 条结果</strong>
                <span>扫描 {result.searchedChunks} 个分块 · {formatDuration(result.durationMs)}</span>
              </header>
              <div className="retrievalResultList">
                {result.items.map((item) => (
                  <article className="retrievalResult" key={item.chunkId}>
                    <header>
                      <span className="retrievalDocument">
                        <FileText size={15} aria-hidden="true" />
                        <strong>{item.documentName}</strong>
                        <code>#{item.position}</code>
                      </span>
                      <span className="retrievalScore">{Math.round(item.score * 100)}%</span>
                    </header>
                    <p>{item.content}</p>
                    <footer>
                      <span>{item.matchType === 'exact' ? '精确命中' : '模糊命中'}</span>
                      <span>{item.mimeType || '未知格式'}</span>
                      <span>{item.tokenCount === null ? 'Token 未统计' : `${item.tokenCount} tokens`}</span>
                    </footer>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
