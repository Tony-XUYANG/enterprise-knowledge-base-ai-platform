# KnowledgeHub 数据库设计

## 设计范围

第一阶段只使用 PostgreSQL，负责用户、权限、AI 应用、知识库、会话和消息数据。
Redis 与 MongoDB 将在出现明确的缓存、限流或大规模非结构化数据需求后引入。

## 实体关系

```mermaid
erDiagram
    USERS ||--o{ USER_ROLES : has
    ROLES ||--o{ USER_ROLES : grants
    USERS ||--o{ AI_APPS : owns
    USERS ||--o{ KNOWLEDGE_BASES : owns
    KNOWLEDGE_BASES ||--o{ KNOWLEDGE_DOCUMENTS : contains
    KNOWLEDGE_DOCUMENTS ||--o{ KNOWLEDGE_DOCUMENT_CHUNKS : splits_into
    AI_APPS ||--o{ APP_KNOWLEDGE_BASES : attaches
    KNOWLEDGE_BASES ||--o{ APP_KNOWLEDGE_BASES : attaches
    USERS ||--o{ CONVERSATIONS : starts
    AI_APPS ||--o{ CONVERSATIONS : serves
    CONVERSATIONS ||--o{ MESSAGES : contains
    USERS ||--o{ REFRESH_TOKENS : authenticates
    USERS ||--o{ SECURITY_EVENTS : audits
    USERS ||--o{ USER_PASSWORD_HISTORY : retains
```

## 关键决策

- 全部业务主键使用 UUID，避免暴露连续编号，也便于未来分布式写入。
- 邮箱在写入前必须转为小写，并通过表达式唯一索引保证账号唯一。
- 用户与角色、应用与知识库均使用关联表表达多对多关系。
- `app_knowledge_bases.owner_id` 配合复合外键，保证应用不能绑定其他所有者的知识库。
- `knowledge_documents` 通过 `(knowledge_base_id, owner_id)` 复合外键继承知识库所有权，并记录来源、解析状态、分块数和 FastGPT Collection ID。
- `knowledge_document_chunks` 保存有序正文和检索元数据；复合外键继续传递所有权，唯一位置约束保证文档内顺序，触发器自动同步文档分块数。
- PostgreSQL `pg_trgm` 为分块正文提供中文短词、子串和近似文本检索能力；知识库检索只读取状态为 `ready` 的文档并按相关度稳定排序。
- 文档正文导入在锁定所属文档后事务性替换全部分块，同时更新 MIME 类型、字节数、SHA-256、处理状态和错误信息；任一步失败都会保留原有内容。
- 消息使用 `(conversation_id, sequence_no)` 唯一约束维持会话内顺序。
- FastGPT 生成在会话行锁下检查进行中任务，并在一个事务内写入用户消息和 `pending` 助手消息；部分唯一索引保证每个对话最多只有一条待生成助手消息，再原位更新为 `completed` 或 `failed`。
- 最新失败助手消息可原位重试，不新增重复用户消息；`metadata` 保存重试次数、历史错误码和重试时间，继续维持原序号审计链路。
- FastGPT API Key 只预留密文字段，应用层不得保存明文密钥。
- 刷新令牌行同时作为稳定设备会话：轮换时原位替换令牌哈希并更新最近活动时间，不为同一设备制造重复会话；访问令牌携带会话 ID，支持识别和单独撤销当前设备。
- 设备会话记录用户代理、API 观察到的来源 IP、登录时间、最近活动与到期时间；这些字段只用于安全审计和用户主动退出设备，不参与授权决策。
- 每个受保护请求都使用访问令牌中的会话 ID 查询 `refresh_tokens` 的所有者、撤销和到期状态；这使退出、改密和会话撤销能立即阻断旧访问令牌，不再等待 JWT 自然过期。
- 认证中间件对每个会话最多每分钟回写一次 `last_used_at`，在设备活动准确度与数据库写放大之间取得平衡。
- `security_events` 保存账号安全活动的不可变快照：事件类型、结果、来源设备/IP、执行会话、目标会话、受控元数据和发生时间；会话 ID 按值保留以避免日志随会话清理而丢失。
- 安全事件查询始终以 `user_id` 限定所有者；密码、令牌、API Key 和请求正文不进入审计元数据。
- `users.failed_login_attempts`、`last_failed_login_at` 和 `locked_until` 组成账号级异常登录保护；登录事务使用行锁串行化同一账号的并发尝试，避免竞态条件绕过锁定阈值。
- 失败窗口外的旧计数自动失效，锁定期结束后在下一次登录尝试中事务性解锁；成功登录和修改密码均会清零失败状态。
- `user_password_history` 按用户保存有序 bcrypt 哈希，迁移时以当前密码哈希回填已有账号，注册时写入首条记录。修改密码在用户行锁和同一事务内完成历史比对、新哈希写入、超额记录清理与全会话撤销；默认保留最新 5 条，可配置为 2-10 条，绝不保存明文密码。
- JSONB 只承载可变扩展字段，核心关系仍使用普通列和外键表达。
- 删除用户、应用等核心数据默认受限，避免级联误删；会话删除时才级联删除消息。

## 后续演进

- 第二阶段加入数据库迁移工具，建表脚本不再直接承担版本升级。
- 需要多租户协作时，引入组织、组织成员和资源权限表。
- 出现热点读取后加入 Redis，并用性能数据证明缓存收益。
- 对话量达到 PostgreSQL 运维瓶颈后，再评估将消息迁移到 MongoDB。
