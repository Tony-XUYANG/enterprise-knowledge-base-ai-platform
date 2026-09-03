'use client';

import {
  FileText,
  FileUp,
  LoaderCircle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type { BatchDocumentContentImportResult } from '@/lib/types';

const maxFiles = 10;
const maxFileBytes = 2 * 1024 * 1024;
const maxTotalBytes = 3 * 1024 * 1024;
const maxFileCharacters = 750_000;

const mimeTypeByExtension: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
};

interface SelectedImportFile {
  id: string;
  name: string;
  content: string;
  mimeType: string;
  sizeBytes: number;
}

interface KnowledgeDocumentsImportDialogProps {
  open: boolean;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  onClose: () => void;
  onImported: (result: BatchDocumentContentImportResult) => void;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function KnowledgeDocumentsImportDialog({
  open,
  knowledgeBaseId,
  knowledgeBaseName,
  onClose,
  onImported,
}: KnowledgeDocumentsImportDialogProps) {
  const [files, setFiles] = useState<SelectedImportFile[]>([]);
  const [chunkSize, setChunkSize] = useState('1000');
  const [chunkOverlap, setChunkOverlap] = useState('100');
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setChunkSize('1000');
    setChunkOverlap('100');
    setReading(false);
    setImporting(false);
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !reading && !importing) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [importing, onClose, open, reading]);

  const totalBytes = useMemo(
    () => files.reduce((total, file) => total + file.sizeBytes, 0),
    [files],
  );
  const parsedChunkSize = Number(chunkSize);
  const parsedChunkOverlap = Number(chunkOverlap);
  const validChunkSettings = Number.isInteger(parsedChunkSize)
    && parsedChunkSize >= 200
    && parsedChunkSize <= 4000
    && Number.isInteger(parsedChunkOverlap)
    && parsedChunkOverlap >= 0
    && parsedChunkOverlap <= 1000
    && parsedChunkOverlap < parsedChunkSize;
  const busy = reading || importing;

  if (!open) return null;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selectedFiles.length === 0) return;

    setReading(true);
    setError('');
    const nextFiles = [...files];
    const rejected: string[] = [];
    let nextTotalBytes = totalBytes;

    for (const [index, file] of selectedFiles.entries()) {
      if (nextFiles.length >= maxFiles) {
        rejected.push(`${file.name}：超过 ${maxFiles} 个文件上限`);
        continue;
      }
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      const mimeType = mimeTypeByExtension[extension];
      if (!mimeType) {
        rejected.push(`${file.name}：格式不支持`);
        continue;
      }
      if (file.size > maxFileBytes) {
        rejected.push(`${file.name}：文件超过 2 MB`);
        continue;
      }
      if (nextFiles.some((item) => item.name.toLocaleLowerCase() === file.name.toLocaleLowerCase())) {
        rejected.push(`${file.name}：文件名重复`);
        continue;
      }

      try {
        const content = await file.text();
        const sizeBytes = new TextEncoder().encode(content).byteLength;
        if (!content.trim()) {
          rejected.push(`${file.name}：文件内容为空`);
          continue;
        }
        if (content.length > maxFileCharacters) {
          rejected.push(`${file.name}：正文超过 750000 个字符`);
          continue;
        }
        if (nextTotalBytes + sizeBytes > maxTotalBytes) {
          rejected.push(`${file.name}：批次正文总计超过 3 MB`);
          continue;
        }
        nextFiles.push({
          id: `${file.name}-${file.lastModified}-${index}`,
          name: file.name,
          content,
          mimeType,
          sizeBytes,
        });
        nextTotalBytes += sizeBytes;
      } catch {
        rejected.push(`${file.name}：读取失败`);
      }
    }

    setFiles(nextFiles);
    if (rejected.length > 0) {
      const visibleReasons = rejected.slice(0, 3).join('；');
      setError(rejected.length > 3
        ? `${visibleReasons}；另有 ${rejected.length - 3} 个文件未加入`
        : visibleReasons);
    }
    setReading(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0 || !validChunkSettings) return;

    setImporting(true);
    setError('');
    try {
      const result = await clientApi<BatchDocumentContentImportResult>(
        `/api/knowledge-bases/${knowledgeBaseId}/documents/import`,
        {
          method: 'POST',
          body: JSON.stringify({
            files: files.map(({ name, content, mimeType }) => ({ name, content, mimeType })),
            chunkSize: parsedChunkSize,
            chunkOverlap: parsedChunkOverlap,
          }),
        },
      );
      onImported(result);
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '批量导入失败，本批文件均未保存',
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="dialogPanel batchImportDialog" role="dialog" aria-modal="true" aria-labelledby="batch-import-title">
        <header className="dialogHeader">
          <span className="dialogTitleWithIcon">
            <span className="relationTitleIcon" aria-hidden="true"><Upload size={19} /></span>
            <span>
              <h2 id="batch-import-title">批量导入文档</h2>
              <small>{knowledgeBaseName}</small>
            </span>
          </span>
          <button className="iconButton" type="button" onClick={onClose} disabled={busy} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        <form className="batchImportForm" onSubmit={handleSubmit} aria-busy={busy}>
          <div className="batchImportBody">
            <label className="batchFilePicker">
              {reading ? <LoaderCircle className="spin" size={22} /> : <FileUp size={22} />}
              <span>
                <strong>{reading ? '正在读取' : '选择文件'}</strong>
                <small>TXT · Markdown · CSV · JSON · HTML</small>
              </span>
              <input
                className="srOnly"
                type="file"
                multiple
                disabled={busy || files.length >= maxFiles}
                accept=".txt,.md,.markdown,.csv,.json,.html,.htm,text/plain,text/markdown,text/csv,text/html,application/json"
                onChange={handleFileChange}
              />
            </label>

            <section className="batchSelectedFiles" aria-label="待导入文件">
              <header>
                <strong>待导入文件</strong>
                <span>{files.length} / {maxFiles} · {formatBytes(totalBytes)}</span>
              </header>
              {files.length === 0 ? (
                <div className="batchFileEmpty"><FileText size={18} />尚未选择文件</div>
              ) : (
                <div className="batchFileList">
                  {files.map((file) => (
                    <article className="batchFileRow" key={file.id}>
                      <span className="batchFileIcon" aria-hidden="true"><FileText size={17} /></span>
                      <span className="batchFileName">
                        <strong title={file.name}>{file.name}</strong>
                        <small>{file.mimeType}</small>
                      </span>
                      <small>{formatBytes(file.sizeBytes)}</small>
                      <button
                        className="iconButton dangerHover"
                        type="button"
                        onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}
                        disabled={busy}
                        aria-label={`移除 ${file.name}`}
                        title="移除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <div className="formGrid equalFormGrid batchImportSettings">
              <label className="field">
                <span>分块长度</span>
                <input type="number" value={chunkSize} min={200} max={4000} step={50} onChange={(event) => setChunkSize(event.target.value)} required />
              </label>
              <label className="field">
                <span>重叠长度</span>
                <input type="number" value={chunkOverlap} min={0} max={1000} step={10} onChange={(event) => setChunkOverlap(event.target.value)} required />
              </label>
            </div>

            {!validChunkSettings && <div className="formError" role="alert">分块长度需为 200-4000，重叠长度需小于分块长度且不超过 1000</div>}
            {error && <div className="formError" role="alert">{error}</div>}
          </div>

          <footer className="dialogActions batchImportActions">
            <button className="secondaryButton" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="primaryButton" type="submit" disabled={busy || files.length === 0 || !validChunkSettings}>
              {importing ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}
              {importing ? '导入中' : `导入 ${files.length} 个文件`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
