import { Router } from 'express';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import { searchKnowledgeBaseSchema } from './knowledge-base-search.schemas.js';
import { searchKnowledgeBase } from './knowledge-base-search.service.js';
import {
  batchImportKnowledgeDocumentsSchema,
  importKnowledgeDocumentContentSchema,
} from './knowledge-document-content.schemas.js';
import {
  batchImportKnowledgeDocuments,
  importKnowledgeDocumentContent,
  previewKnowledgeDocumentContent,
} from './knowledge-document-content.service.js';
import {
  createKnowledgeDocumentChunkSchema,
  knowledgeDocumentChunkIdSchema,
  listKnowledgeDocumentChunksQuerySchema,
  updateKnowledgeDocumentChunkSchema,
} from './knowledge-document-chunks.schemas.js';
import {
  createKnowledgeDocumentChunk,
  deleteKnowledgeDocumentChunk,
  listKnowledgeDocumentChunks,
  updateKnowledgeDocumentChunk,
} from './knowledge-document-chunks.service.js';
import {
  createKnowledgeDocumentSchema,
  knowledgeDocumentIdSchema,
  listKnowledgeDocumentsQuerySchema,
  updateKnowledgeDocumentSchema,
} from './knowledge-documents.schemas.js';
import {
  createKnowledgeDocument,
  disableKnowledgeDocument,
  getKnowledgeDocumentStats,
  listKnowledgeDocuments,
  updateKnowledgeDocument,
} from './knowledge-documents.service.js';
import {
  createKnowledgeBaseSchema,
  knowledgeBaseIdSchema,
  listKnowledgeBasesQuerySchema,
  updateKnowledgeBaseSchema,
} from './knowledge-bases.schemas.js';
import {
  createKnowledgeBase,
  disableKnowledgeBase,
  getKnowledgeBaseStats,
  getKnowledgeBase,
  listKnowledgeBaseApps,
  listKnowledgeBases,
  updateKnowledgeBase,
} from './knowledge-bases.service.js';

export const knowledgeBasesRouter = Router();

knowledgeBasesRouter.use(authenticate);

function authenticatedUserId(request: Express.Request): string {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  return request.auth.userId;
}

knowledgeBasesRouter.post('/', async (request, response) => {
  const knowledgeBase = await createKnowledgeBase(
    authenticatedUserId(request),
    createKnowledgeBaseSchema.parse(request.body),
  );
  response.status(201).json({ data: knowledgeBase });
});

knowledgeBasesRouter.get('/', async (request, response) => {
  const result = await listKnowledgeBases(
    authenticatedUserId(request),
    listKnowledgeBasesQuerySchema.parse(request.query),
  );
  response.json({ data: result });
});

knowledgeBasesRouter.get('/stats', async (request, response) => {
  response.json({ data: await getKnowledgeBaseStats(authenticatedUserId(request)) });
});

knowledgeBasesRouter.get('/:knowledgeBaseId', async (request, response) => {
  const knowledgeBase = await getKnowledgeBase(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
  );
  response.json({ data: knowledgeBase });
});

knowledgeBasesRouter.patch('/:knowledgeBaseId', async (request, response) => {
  const knowledgeBase = await updateKnowledgeBase(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
    updateKnowledgeBaseSchema.parse(request.body),
  );
  response.json({ data: knowledgeBase });
});

knowledgeBasesRouter.delete('/:knowledgeBaseId', async (request, response) => {
  await disableKnowledgeBase(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
  );
  response.status(204).send();
});

knowledgeBasesRouter.get('/:knowledgeBaseId/apps', async (request, response) => {
  const items = await listKnowledgeBaseApps(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
  );
  response.json({ data: items });
});

knowledgeBasesRouter.post('/:knowledgeBaseId/search', async (request, response) => {
  const result = await searchKnowledgeBase(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
    searchKnowledgeBaseSchema.parse(request.body),
  );
  response.json({ data: result });
});

knowledgeBasesRouter.post('/:knowledgeBaseId/documents', async (request, response) => {
  const document = await createKnowledgeDocument(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
    createKnowledgeDocumentSchema.parse(request.body),
  );
  response.status(201).json({ data: document });
});

knowledgeBasesRouter.post('/:knowledgeBaseId/documents/import', async (request, response) => {
  const result = await batchImportKnowledgeDocuments(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
    batchImportKnowledgeDocumentsSchema.parse(request.body),
  );
  response.status(201).json({ data: result });
});

knowledgeBasesRouter.get('/:knowledgeBaseId/documents', async (request, response) => {
  const result = await listKnowledgeDocuments(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
    listKnowledgeDocumentsQuerySchema.parse(request.query),
  );
  response.json({ data: result });
});

knowledgeBasesRouter.get('/:knowledgeBaseId/documents/stats', async (request, response) => {
  const stats = await getKnowledgeDocumentStats(
    authenticatedUserId(request),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
  );
  response.json({ data: stats });
});

knowledgeBasesRouter.patch(
  '/:knowledgeBaseId/documents/:documentId',
  async (request, response) => {
    const document = await updateKnowledgeDocument(
      authenticatedUserId(request),
      knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
      knowledgeDocumentIdSchema.parse(request.params.documentId),
      updateKnowledgeDocumentSchema.parse(request.body),
    );
    response.json({ data: document });
  },
);

knowledgeBasesRouter.delete(
  '/:knowledgeBaseId/documents/:documentId',
  async (request, response) => {
    await disableKnowledgeDocument(
      authenticatedUserId(request),
      knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
      knowledgeDocumentIdSchema.parse(request.params.documentId),
    );
    response.status(204).send();
  },
);

knowledgeBasesRouter.post(
  '/:knowledgeBaseId/documents/:documentId/content/preview',
  async (request, response) => {
    const preview = await previewKnowledgeDocumentContent(
      authenticatedUserId(request),
      knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
      knowledgeDocumentIdSchema.parse(request.params.documentId),
      importKnowledgeDocumentContentSchema.parse(request.body),
    );
    response.json({ data: preview });
  },
);

knowledgeBasesRouter.put(
  '/:knowledgeBaseId/documents/:documentId/content',
  async (request, response) => {
    const result = await importKnowledgeDocumentContent(
      authenticatedUserId(request),
      knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
      knowledgeDocumentIdSchema.parse(request.params.documentId),
      importKnowledgeDocumentContentSchema.parse(request.body),
    );
    response.json({ data: result });
  },
);

knowledgeBasesRouter.post(
  '/:knowledgeBaseId/documents/:documentId/chunks',
  async (request, response) => {
    const chunk = await createKnowledgeDocumentChunk(
      authenticatedUserId(request),
      knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
      knowledgeDocumentIdSchema.parse(request.params.documentId),
      createKnowledgeDocumentChunkSchema.parse(request.body),
    );
    response.status(201).json({ data: chunk });
  },
);

knowledgeBasesRouter.get(
  '/:knowledgeBaseId/documents/:documentId/chunks',
  async (request, response) => {
    const chunks = await listKnowledgeDocumentChunks(
      authenticatedUserId(request),
      knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
      knowledgeDocumentIdSchema.parse(request.params.documentId),
      listKnowledgeDocumentChunksQuerySchema.parse(request.query),
    );
    response.json({ data: chunks });
  },
);

knowledgeBasesRouter.patch(
  '/:knowledgeBaseId/documents/:documentId/chunks/:chunkId',
  async (request, response) => {
    const chunk = await updateKnowledgeDocumentChunk(
      authenticatedUserId(request),
      knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
      knowledgeDocumentIdSchema.parse(request.params.documentId),
      knowledgeDocumentChunkIdSchema.parse(request.params.chunkId),
      updateKnowledgeDocumentChunkSchema.parse(request.body),
    );
    response.json({ data: chunk });
  },
);

knowledgeBasesRouter.delete(
  '/:knowledgeBaseId/documents/:documentId/chunks/:chunkId',
  async (request, response) => {
    await deleteKnowledgeDocumentChunk(
      authenticatedUserId(request),
      knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
      knowledgeDocumentIdSchema.parse(request.params.documentId),
      knowledgeDocumentChunkIdSchema.parse(request.params.chunkId),
    );
    response.status(204).send();
  },
);
