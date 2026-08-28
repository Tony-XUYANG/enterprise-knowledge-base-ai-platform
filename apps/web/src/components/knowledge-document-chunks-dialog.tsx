'use client';

import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  LoaderCircle,
  Pencil,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  KnowledgeDocument,
  KnowledgeDocumentChunk,
  KnowledgeDocumentChunkList,
} from '@/lib/types';
import { ConfirmDialog } from './confirm-dialog';

const chunkPageSize = 12;

interface KnowledgeDocumentChunksDialogProps {
  open: boolean;
  knowledgeBaseId: string;
  knowledgeDocument: KnowledgeDocument | null;
  onClose: () => void;
  onChanged: () => void;
}

export function KnowledgeDocumentChunksDialog({
  open,
  knowledgeBaseId,
  knowledgeDocument,
  onClose,
  onChanged,
}: KnowledgeDocumentChunksDialogProps) {
  const [data, setData] = useState<KnowledgeDocumentChunkList>({
    items: [],
    page: 1,
    pageSize: chunkPageSize,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingChunk, setEditingChunk] = useState<KnowledgeDocumentChunk | null>(null);
  const [content, setContent] = useState('');
  const [tokenCount, setTokenCount] = useState('');
  const [fastgptDataId, setFastgptDataId] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingChunk, setDeletingChunk] = useState<KnowledgeDocumentChunk | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!open) {
      setEditorOpen(false);
      setEditingChunk(null);
      setDeletingChunk(null);
      return;
    }
    setPage(1);
    setSearchInput('');
    setSearch('');
    setError('');
  }, [knowledgeDocument?.id, open]);

  const loadChunks = useCallback(async () => {
    if (!open || !knowledgeDocument) return;
    setLoading(true);
    setError('');
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(chunkPageSize),
    });
    if (search) parameters.set('search', search);

    try {
      setData(
        await clientApi<KnowledgeDocumentChunkList>(
          `/api/knowledge-bases/${knowledgeBaseId}/documents/${knowledgeDocument.id}/chunks?${parameters}`,
        ),
      );
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '分块加载失败，请稍后重试',
      );
    } finally {
      setLoading(false);
    }
  }, [knowledgeBaseId, knowledgeDocument, open, page, reloadKey, search]);

  useEffect(() => {
    void loadChunks();
  }, [loadChunks]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !deletingChunk) {
        if (editorOpen) setEditorOpen(false);
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deletingChunk, editorOpen, onClose, open, saving]);

  if (!open || !knowledgeDocument) return null;

  const documentId = knowledgeDocument.id;
  const totalPages = Math.max(1, Math.ceil(data.total / chunkPageSize));

  function openCreateEditor() {
    setEditingChunk(null);
    setContent('');
    setTokenCount('');
    setFastgptDataId('');
    setError('');
    setEditorOpen(true);
  }

  function openEditEditor(chunk: KnowledgeDocumentChunk) {
    setEditingChunk(chunk);
    setContent(chunk.content);
    setTokenCount(chunk.tokenCount === null ? '' : String(chunk.tokenCount));
    setFastgptDataId(chunk.fastgptDataId ?? '');
    setError('');
    setEditorOpen(true);
  }

  async function saveChunk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const body = JSON.stringify({
      content,
      tokenCount: tokenCount === '' ? null : Number(tokenCount),
      fastgptDataId: fastgptDataId || null,
    });
    const basePath = `/api/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`;

    try {
      await clientApi<KnowledgeDocumentChunk>(
        editingChunk ? `${basePath}/${editingChunk.id}` : basePath,
        { method: editingChunk ? 'PATCH' : 'POST', body },
      );
      setEditorOpen(false);
      setEditingChunk(null);
      setReloadKey((key) => key + 1);
      onChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '分块保存失败，请稍后重试',
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteChunk() {
    if (!deletingChunk) return;
    try {
      await clientApi<void>(
        `/api/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks/${deletingChunk.id}`,
        { method: 'DELETE' },
      );
      setDeletingChunk(null);
      if (data.items.length === 1 && page > 1) setPage((current) => current - 1);
      else setReloadKey((key) => key + 1);
      onChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '分块删除失败，请稍后重试',
      );
      throw requestError;
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving && !deletingChunk) onClose();
    }}>
      <section className="dialogPanel chunkManagerDialog" role="dialog" aria-modal="true" aria-labelledby="chunk-manager-title">
        <header className="dialogHeader">
          <div className="dialogTitleWithIcon">
            <span className="relationTitleIcon" aria-hidden="true"><Boxes size={19} /></span>
            <span>
              <h2 id="chunk-manager-title">{editorOpen ? (editingChunk ? '编辑分块' : '新增分块') : '文档分块'}</h2>
              <small>{knowledgeDocument.name}</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={editorOpen ? () => setEditorOpen(false) : onClose} disabled={saving} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        {editorOpen ? (
          <form className="chunkEditor" onSubmit={saveChunk}>
            <label className="field">
              <span>分块内容</span>
              <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={100000} rows={12} autoFocus required />
            </label>
            <div className="formGrid equalFormGrid">
              <label className="field">
                <span>Token 数量</span>
                <input type="number" value={tokenCount} onChange={(event) => setTokenCount(event.target.value)} min={0} step={1} />
              </label>
              <label className="field">
                <span>FastGPT Data ID</span>
                <input value={fastgptDataId} onChange={(event) => setFastgptDataId(event.target.value)} maxLength={160} />
              </label>
            </div>
            {error && <div className="formError" role="alert">{error}</div>}
            <footer className="dialogActions chunkEditorActions">
              <button className="secondaryButton" type="button" onClick={() => setEditorOpen(false)} disabled={saving}>取消</button>
              <button className="primaryButton" type="submit" disabled={saving || !content.trim()}>
                {saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
                {saving ? '保存中' : '保存分块'}
              </button>
            </footer>
          </form>
        ) : (
          <>
            <div className="chunkToolbar">
              <label className="searchBox">
                <Search size={17} aria-hidden="true" />
                <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索分块内容" aria-label="搜索分块内容" />
              </label>
              <button className="primaryButton" type="button" onClick={openCreateEditor}><CirclePlus size={17} />新增分块</button>
            </div>

            {error && <div className="chunkError formError" role="alert">{error}</div>}

            <div className="chunkList" aria-busy={loading}>
              {loading ? (
                <div className="chunkEmpty"><LoaderCircle className="spin" size={20} />正在加载分块</div>
              ) : data.items.length === 0 ? (
                <div className="chunkEmpty">{search ? '没有匹配的分块' : '该文档还没有内容分块'}</div>
              ) : data.items.map((chunk) => (
                <article className="chunkEntry" key={chunk.id}>
                  <span className="chunkPosition">#{chunk.position}</span>
                  <div className="chunkContent">
                    <p>{chunk.content}</p>
                    <footer>
                      <span>{chunk.tokenCount === null ? 'Token 未统计' : `${chunk.tokenCount} tokens`}</span>
                      {chunk.fastgptDataId && <code>{chunk.fastgptDataId}</code>}
                    </footer>
                  </div>
                  <div className="chunkActions">
                    <button className="iconButton" type="button" onClick={() => openEditEditor(chunk)} aria-label={`编辑分块 ${chunk.position}`} title="编辑"><Pencil size={16} /></button>
                    <button className="iconButton dangerHover" type="button" onClick={() => setDeletingChunk(chunk)} aria-label={`删除分块 ${chunk.position}`} title="删除"><Trash2 size={16} /></button>
                  </div>
                </article>
              ))}
            </div>

            <footer className="chunkFooter">
              <span>{data.total} 个分块</span>
              <div>
                <button className="iconButton" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="上一页" title="上一页"><ChevronLeft size={18} /></button>
                <span>{page} / {totalPages}</span>
                <button className="iconButton" type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages} aria-label="下一页" title="下一页"><ChevronRight size={18} /></button>
              </div>
            </footer>
          </>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deletingChunk)}
        appName={`分块 #${deletingChunk?.position ?? ''}`}
        subjectLabel="分块"
        variant="delete"
        onClose={() => setDeletingChunk(null)}
        onConfirm={deleteChunk}
      />
    </div>
  );
}
