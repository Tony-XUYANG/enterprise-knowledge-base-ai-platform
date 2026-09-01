export interface User {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  emailVerifiedAt: string;
}

export type ManagedUserRole = 'admin' | 'member';
export type ManagedUserStatus = 'active' | 'disabled';

export interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  status: ManagedUserStatus;
  role: ManagedUserRole;
  emailVerifiedAt: string | null;
  mfaEnabledAt: string | null;
  lastLoginAt: string | null;
  activeSessions: number;
  current: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedUserList {
  items: ManagedUser[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ManagedUserStats {
  total: number;
  active: number;
  disabled: number;
  admins: number;
  pendingVerification: number;
}

export interface SessionSummary {
  activeSessions: number;
  lastLoginAt: string | null;
  loginProtection: LoginProtection;
  items: AuthSession[];
}

export interface LoginProtection {
  status: 'protected' | 'locked';
  failedAttempts: number;
  failureLimit: number;
  failureWindowMinutes: number;
  lockoutMinutes: number;
  lockedUntil: string | null;
}

export interface AuthSession {
  id: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  expiresAt: string;
  createdAt: string;
  current: boolean;
}

export type SecurityEventType =
  | 'account_registered'
  | 'login_succeeded'
  | 'login_failed'
  | 'account_locked'
  | 'account_unlocked'
  | 'profile_updated'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'refresh_token_reused'
  | 'session_revoked'
  | 'all_sessions_revoked'
  | 'logout'
  | 'mfa_setup_started'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_recovery_codes_regenerated'
  | 'mfa_login_failed'
  | 'email_verification_requested'
  | 'email_verified'
  | 'user_role_changed'
  | 'user_status_changed';

export interface SecurityEvent {
  id: string;
  eventType: SecurityEventType;
  outcome: 'success' | 'failure';
  actorSessionId: string | null;
  targetSessionId: string | null;
  deviceName: string;
  deviceType: AuthSession['deviceType'];
  userAgent: string | null;
  ipAddress: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface SecurityEventList {
  items: SecurityEvent[];
  total: number;
}

export type AppStatus = 'draft' | 'active' | 'disabled';

export interface AiApp {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  fastgptAppId: string | null;
  hasFastgptApiKey: boolean;
  settings: Record<string, unknown>;
  status: AppStatus;
  attachedKnowledgeBaseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppList {
  items: AiApp[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AppStats {
  total: number;
  active: number;
  draft: number;
  disabled: number;
  knowledgeBaseBindings: number;
}

export type KnowledgeBaseStatus = 'pending' | 'ready' | 'failed' | 'disabled';

export interface KnowledgeBase {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  fastgptDatasetId: string | null;
  status: KnowledgeBaseStatus;
  metadata: Record<string, unknown>;
  attachedAppCount: number;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeDocumentStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'disabled';
export type KnowledgeDocumentSourceType = 'file' | 'url' | 'text';

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  ownerId: string;
  name: string;
  sourceType: KnowledgeDocumentSourceType;
  sourceUri: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksumSha256: string | null;
  fastgptCollectionId: string | null;
  status: KnowledgeDocumentStatus;
  chunkCount: number;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentList {
  items: KnowledgeDocument[];
  page: number;
  pageSize: number;
  total: number;
}

export interface KnowledgeDocumentStats {
  total: number;
  ready: number;
  processing: number;
  pending: number;
  failed: number;
  disabled: number;
  chunks: number;
  totalBytes: number;
}

export interface KnowledgeDocumentChunk {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  ownerId: string;
  position: number;
  content: string;
  tokenCount: number | null;
  fastgptDataId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentChunkList {
  items: KnowledgeDocumentChunk[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DocumentContentChunkPreview {
  position: number;
  content: string;
  characterCount: number;
}

export interface DocumentContentSummary {
  chunkCount: number;
  totalCharacters: number;
  sizeBytes: number;
  chunks: DocumentContentChunkPreview[];
  previewTruncated: boolean;
}

export interface DocumentContentImportResult {
  document: KnowledgeDocument;
  summary: DocumentContentSummary;
}

export interface KnowledgeBaseList {
  items: KnowledgeBase[];
  page: number;
  pageSize: number;
  total: number;
}

export interface KnowledgeBaseStats {
  total: number;
  ready: number;
  pending: number;
  failed: number;
  disabled: number;
  appBindings: number;
}

export interface KnowledgeBaseSearchItem {
  chunkId: string;
  documentId: string;
  documentName: string;
  sourceType: KnowledgeDocumentSourceType;
  mimeType: string | null;
  position: number;
  content: string;
  tokenCount: number | null;
  score: number;
  matchType: 'exact' | 'fuzzy';
}

export interface KnowledgeBaseSearchResult {
  query: string;
  items: KnowledgeBaseSearchItem[];
  searchedChunks: number;
  durationMs: number;
}

export interface KnowledgeBaseLinkedApp {
  id: string;
  name: string;
  description: string | null;
  fastgptAppId: string | null;
  status: AppStatus;
  attachedAt: string;
}

export type ConversationStatus = 'active' | 'archived';
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MessageStatus = 'pending' | 'completed' | 'failed';

export interface Conversation {
  id: string;
  appId: string;
  appName: string;
  userId: string;
  title: string;
  status: ConversationStatus;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationList {
  items: Conversation[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ConversationStats {
  total: number;
  active: number;
  archived: number;
  messages: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sequenceNo: number;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  externalMessageId: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ConversationMessage[];
}

export interface ConversationGenerationResult {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
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

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export interface MfaRequiredResult {
  mfaRequired: true;
  mfaToken: string;
  expiresIn: number;
}

export interface RegistrationVerificationRequired {
  verificationRequired: true;
  email: string;
  expiresIn: number;
}

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

export interface MfaSetup {
  manualKey: string;
  qrCodeDataUrl: string;
  expiresAt: string;
}

export interface MfaActivation {
  enabledAt: string;
  recoveryCodes: string[];
  revokedSessions: number;
}

export interface MfaRecoveryCodeResult {
  recoveryCodes: string[];
  revokedSessions: number;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}
