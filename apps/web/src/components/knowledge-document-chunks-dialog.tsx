'use client';

import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Eye,
  FileUp,
  LoaderCircle,
  Pencil,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  DocumentContentImportResult,
  DocumentContentSummary,
  KnowledgeDocument,
  KnowledgeDocumentChunk,
  KnowledgeDocumentChunkList,
} from '@/lib/types';
import { ConfirmDialog } from './confirm-dialog';

const chunkPageSize = 12;
const maxImportCharacters = 750_000;
const maxFileBytes = 2 * 1024 * 1024;

type DialogView = 'list' | 'editor' | 'import';

const mimeTypeByExtension: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

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
  const [view, setView] = useState<DialogView>('list');
  const [editingChunk, setEditingChunk] = useState<KnowledgeDocumentChunk | null>(null);
  const [content, setContent] = useState('');
  const [tokenCount, setTokenCount] = useState('');
  const [fastgptDataId, setFastgptDataId] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingChunk, setDeletingChunk] = useState<KnowledgeDocumentChunk | null>(null);
  const [importContent, setImportContent] = useState('');
  const [importFile, setImportFile] = useState<{ name: string; size: number } | null>(null);
  const [importMimeType, setImportMimeType] = useState('text/plain');
  const [chunkSize, setChunkSize] = useState('1000');
  const [chunkOverlap, setChunkOverlap] = useState('100');
  const [importPreview, setImportPreview] = useState<DocumentContentSummary | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!open) {
      setView('list');
      setEditingChunk(null);
      setDeletingChunk(null);
      setReplaceConfirmOpen(false);
      return;
    }
    setView('list');
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
      if (
        event.key === 'Escape'
        && !saving
        && !previewing
        && !importing
        && !deletingChunk
        && !replaceConfirmOpen
      ) {
        if (view !== 'list') setView('list');
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deletingChunk, importing, onClose, open, previewing, replaceConfirmOpen, saving, view]);

  if (!open || !knowledgeDocument) return null;

  const documentId = knowledgeDocument.id;
  const totalPages = Math.max(1, Math.ceil(data.total / chunkPageSize));
  const parsedChunkSize = Number(chunkSize);
  const parsedChunkOverlap = Number(chunkOverlap);
  const validChunkSettings = Number.isInteger(parsedChunkSize)
    && parsedChunkSize >= 200
    && parsedChunkSize <= 4000
    && Number.isInteger(parsedChunkOverlap)
    && parsedChunkOverlap >= 0
    && parsedChunkOverlap <= 1000
    && parsedChunkOverlap < parsedChunkSize;
  const busy = saving || previewing || importing;

  function resetImportForm() {
    setImportContent('');
    setImportFile(null);
    setImportMimeType('text/plain');
    setChunkSize('1000');
    setChunkOverlap('100');
    setImportPreview(null);
  }

  function openCreateEditor() {
    setEditingChunk(null);
    setContent('');
    setTokenCount('');
    setFastgptDataId('');
    setError('');
    setView('editor');
  }

  function openEditEditor(chunk: KnowledgeDocumentChunk) {
    setEditingChunk(chunk);
    setContent(chunk.content);
    setTokenCount(chunk.tokenCount === null ? '' : String(chunk.tokenCount));
    setFastgptDataId(chunk.fastgptDataId ?? '');
    setError('');
    setView('editor');
  }

  function openImport() {
    resetImportForm();
    setError('');
    setView('import');
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
      setView('list');
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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = mimeTypeByExtension[extension];
    if (!mimeType) {
      setError('仅支持 TXT、Markdown、CSV、JSON 和 HTML 文本文件');
      return;
    }
    if (file.size > maxFileBytes) {
      setError('文件不能超过 2 MB');
      return;
    }

    try {
      const fileContent = await file.text();
      if (fileContent.length > maxImportCharacters) {
        setError('文档内容不能超过 750000 个字符');
        return;
      }
      setImportContent(fileContent);
      setImportFile({ name: file.name, size: file.size });
      setImportMimeType(mimeType);
      setImportPreview(null);
      setError('');
    } catch {
      setError('文件读取失败，请重新选择');
    }
  }

  function importRequestBody() {
    return JSON.stringify({
      content: importContent,
      chunkSize: parsedChunkSize,
      chunkOverlap: parsedChunkOverlap,
      mimeType: importMimeType,
    });
  }

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewing(true);
    setError('');
    try {
      const preview = await clientApi<DocumentContentSummary>(
        `/api/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/content/preview`,
        { method: 'POST', body: importRequestBody() },
      );
      setImportPreview(preview);
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '内容预览失败，请稍后重试',
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function performImport() {
    setImporting(true);
    setError('');
    try {
      await clientApi<DocumentContentImportResult>(
        `/api/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/content`,
        { method: 'PUT', body: importRequestBody() },
      );
      setReplaceConfirmOpen(false);
      setView('list');
      setPage(1);
      setSearchInput('');
      setSearch('');
      setReloadKey((key) => key + 1);
      onChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '内容导入失败，原有分块未被修改',
      );
      throw requestError;
    } finally {
      setImporting(false);
    }
  }

  async function requestImport() {
    if (!importPreview) return;
    if (data.total > 0) {
      setReplaceConfirmOpen(true);
      return;
    }
    await performImport().catch(() => undefined);
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

  const title = view === 'import'
    ? '导入文档内容'
    : view === 'editor'
      ? editingChunk ? '编辑分块' : '新增分块'
      : '文档分块';

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy && !deletingChunk && !replaceConfirmOpen) onClose();
    }}>
      <section className="dialogPanel chunkManagerDialog" role="dialog" aria-modal="true" aria-labelledby="chunk-manager-title">
        <header className="dialogHeader">
          <div className="dialogTitleWithIcon">
            <span className="relationTitleIcon" aria-hidden="true"><Boxes size={19} /></span>
            <span>
              <h2 id="chunk-manager-title">{title}</h2>
              <small>{knowledgeDocument.name}</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={view === 'list' ? onClose : () => setView('list')} disabled={busy} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        {view === 'editor' ? (
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
              <button className="secondaryButton" type="button" onClick={() => setView('list')} disabled={saving}>取消</button>
              <button className="primaryButton" type="submit" disabled={saving || !content.trim()}>
                {saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
                {saving ? '保存中' : '保存分块'}
              </button>
            </footer>
          </form>
        ) : view === 'import' ? (
          <form className="contentImportForm" onSubmit={previewImport} aria-busy={previewing || importing}>
            <div className="contentImportBody">
              <div className="importSourceRow">
                <label className="secondaryButton fileSelectButton">
                  <FileUp size={17} />
                  <span>{importFile ? '重新选择' : '选择文本文件'}</span>
                  <input className="srOnly" type="file" accept=".txt,.md,.markdown,.csv,.json,.html,.htm,text/plain,text/markdown,text/csv,text/html,application/json" onChange={handleFileChange} />
                </label>
                {importFile && (
                  <span className="selectedFileMeta" title={importFile.name}>
                    <strong>{importFile.name}</strong>
                    <small>{formatBytes(importFile.size)}</small>
                  </span>
                )}
              </div>

              <label className="field">
                <span>正文内容</span>
                <textarea
                  value={importContent}
                  onChange={(event) => {
                    setImportContent(event.target.value);
                    setImportFile(null);
                    setImportPreview(null);
                  }}
                  maxLength={maxImportCharacters}
                  rows={10}
                  placeholder="粘贴需要导入的正文"
                  autoFocus
                  required
                />
                <small className="fieldCounter">{importContent.length.toLocaleString('zh-CN')} / {maxImportCharacters.toLocaleString('zh-CN')}</small>
              </label>

              <div className="formGrid importSettingsGrid">
                <label className="field">
                  <span>分块长度</span>
                  <input type="number" value={chunkSize} min={200} max={4000} step={50} onChange={(event) => { setChunkSize(event.target.value); setImportPreview(null); }} required />
                </label>
                <label className="field">
                  <span>重叠长度</span>
                  <input type="number" value={chunkOverlap} min={0} max={1000} step={10} onChange={(event) => { setChunkOverlap(event.target.value); setImportPreview(null); }} required />
                </label>
                <label className="field">
                  <span>内容格式</span>
                  <select value={importMimeType} onChange={(event) => { setImportMimeType(event.target.value); setImportPreview(null); }}>
                    <option value="text/plain">纯文本</option>
                    <option value="text/markdown">Markdown</option>
                    <option value="text/csv">CSV</option>
                    <option value="application/json">JSON</option>
                    <option value="text/html">HTML</option>
                  </select>
                </label>
              </div>

              {!validChunkSettings && <div className="formError" role="alert">分块长度需为 200-4000，重叠长度需小于分块长度且不超过 1000</div>}
              {error && <div className="formError" role="alert">{error}</div>}

              {importPreview && (
                <section className="contentImportPreview" aria-label="导入预览">
                  <header>
                    <h3>分块预览</h3>
                    <span>{importPreview.chunkCount} 块 · {importPreview.totalCharacters.toLocaleString('zh-CN')} 字符 · {formatBytes(importPreview.sizeBytes)}</span>
                  </header>
                  <div className="importPreviewList">
                    {importPreview.chunks.map((chunk) => (
                      <article key={chunk.position}>
                        <span className="chunkPosition">#{chunk.position}</span>
                        <p>{chunk.content}</p>
                        <small>{chunk.characterCount} 字符</small>
                      </article>
                    ))}
                  </div>
                  {importPreview.previewTruncated && <footer>显示前 {importPreview.chunks.length} 个分块</footer>}
                  {data.total > 0 && <div className="replaceNotice">确认导入后将替换现有 {data.total} 个分块</div>}
                </section>
              )}
            </div>

            <footer className="dialogActions contentImportActions">
              <button className="secondaryButton" type="button" onClick={() => setView('list')} disabled={previewing || importing}>取消</button>
              {!importPreview ? (
                <button className="primaryButton" type="submit" disabled={previewing || !importContent.trim() || !validChunkSettings}>
                  {previewing ? <LoaderCircle className="spin" size={18} /> : <Eye size={18} />}
                  {previewing ? '生成中' : '生成预览'}
                </button>
              ) : (
                <button className="primaryButton" type="button" onClick={requestImport} disabled={importing}>
                  {importing ? <LoaderCircle className="spin" size={18} /> : <FileUp size={18} />}
                  {importing ? '导入中' : '确认导入'}
                </button>
              )}
            </footer>
          </form>
        ) : (
          <>
            <div className="chunkToolbar">
              <label className="searchBox">
                <Search size={17} aria-hidden="true" />
                <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索分块内容" aria-label="搜索分块内容" />
              </label>
              <div className="chunkToolbarActions">
                <button className="secondaryButton" type="button" onClick={openImport}><FileUp size={17} />导入内容</button>
                <button className="primaryButton" type="button" onClick={openCreateEditor}><CirclePlus size={17} />新增分块</button>
              </div>
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
      <ConfirmDialog
        open={replaceConfirmOpen}
        appName={knowledgeDocument.name}
        subjectLabel="文档"
        variant="replace"
        onClose={() => setReplaceConfirmOpen(false)}
        onConfirm={performImport}
      />
    </div>
  );
}
