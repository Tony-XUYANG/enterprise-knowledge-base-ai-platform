# KnowledgeHub 运维手册

## 生产部署

生产环境使用 `compose.production.yaml` 启动三个服务：PostgreSQL、API 和 Next.js Web。API 容器启动时会先以迁移锁执行所有未应用的 SQL 迁移，迁移失败或数据库未就绪时最多重试 30 次；迁移成功后才接受流量。

```powershell
Copy-Item .env.production.example .env.production
# 编辑 .env.production，替换所有 CHANGE_ME 值和域名
powershell -ExecutionPolicy Bypass -File .\scripts\preflight-production.ps1
docker compose -f .\compose.production.yaml --env-file .env.production up -d --build
docker compose -f .\compose.production.yaml --env-file .env.production ps
```

生产环境必须使用独立的 `JWT_SECRET`、64 位十六进制 `DATA_ENCRYPTION_KEY`、数据库密码、外部 SMTP 和公网 `CORS_ORIGIN` / `WEB_BASE_URL`。反向代理位于 API 前方时设置 `TRUST_PROXY=true`，否则保留 `false`。多副本部署前需要把内存限流替换为共享存储（当前外部聊天限流器是单实例内存实现）。

## 健康检查

- `GET /health/live`：仅表示 Node.js 进程存活，不访问数据库，适合 liveness probe。
- `GET /health/ready`：执行 `SELECT 1`，数据库不可用时返回 `503 DATABASE_UNAVAILABLE`，适合 readiness probe 和负载均衡摘流。
- `GET /health`：兼容旧检查脚本，行为等同 `/health/ready`。

API 收到 `SIGTERM` / `SIGINT` 后停止接收新连接，关闭空闲连接，等待活动请求最多 8 秒，再释放 PostgreSQL 连接池。容器通过 `init: true` 回收子进程，并设置 `no-new-privileges`、非 root 用户、只读根文件系统和 `/tmp` 临时盘。

## 备份与恢复

备份前确认数据库容器健康。脚本生成 PostgreSQL custom-format 文件，便于按表或整库恢复：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-production-db.ps1
```

恢复应在维护窗口执行，并先停止 API 写入：

```powershell
docker compose -f .\compose.production.yaml --env-file .env.production stop api
Get-Content .\backups\knowledgehub-YYYYMMDD-HHMMSS.dump -Encoding Byte |
  docker compose -f .\compose.production.yaml --env-file .env.production exec -T db pg_restore -U knowledgehub -d knowledgehub --clean --if-exists
docker compose -f .\compose.production.yaml --env-file .env.production start api
```

## 迁移发布

迁移文件只允许前向追加，不能修改已应用文件。发布前运行：

```powershell
npm.cmd run db:migrate
docker compose -f .\compose.production.yaml --env-file .env.production exec api node /app/apps/api/dist/db/migrate.js
```

迁移状态与 SHA-256 校验和保存在 `schema_migrations`。如果检测到已应用迁移文件被修改，API 会拒绝启动，避免不同实例使用不一致的结构。

## 日志与告警

API 使用结构化日志。授权头、Cookie、幂等键、密码、验证码、MFA、重置令牌、FastGPT 凭据和外部聊天正文都会被脱敏。建议采集以下告警：API `/health/ready` 连续失败、容器重启次数增长、迁移失败、外部调用 `5xx` 比例升高、`IDEMPOTENCY_IN_PROGRESS` 长时间积压和 PostgreSQL 磁盘空间不足。

外部调用日志可在应用工作台查看，也可通过 `GET /api/v1/apps/:appId/external-requests` 查询。它只记录安全前缀、结果、错误码、耗时、Token、来源 IP 和会话关联，不保存用户问题或模型回复正文。

## 幂等重试

外部客户端对可能超时的 `POST /api/v1/external/chat` 请求应发送唯一的 `Idempotency-Key`（1-128 个可打印 ASCII 字符），并在网络错误后使用同一键重试。成功请求会复用已落库的用户/助手消息；相同键但请求正文不同会返回 `409 IDEMPOTENCY_KEY_REUSED`；原请求仍在执行时返回 `409 IDEMPOTENCY_IN_PROGRESS`。幂等记录保留 24 小时，过期后可重新使用同一键。
