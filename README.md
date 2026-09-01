# 企业知识库 AI 平台

面向 FastGPT 全栈岗位训练的企业知识库 AI 平台。项目已包含 PostgreSQL 数据模型、Node.js API 和 Next.js 管理工作台。

## 环境要求

- Docker Desktop
- Docker Compose
- PowerShell 7 或 Windows PowerShell 5.1

本机 `5432` 端口已有服务占用，因此开发数据库默认使用 `localhost:5433`。

## 启动数据库

```powershell
Copy-Item .env.example .env
docker compose up -d
docker compose ps
```

本地邮件由 Mailpit 接收：SMTP 监听 `localhost:1025`，浏览器收件箱为 `http://localhost:8025`。生产环境应通过 `SMTP_*` 和 `MAIL_FROM` 连接企业邮件服务。

首次创建数据卷时，PostgreSQL 会自动执行：

- `database/init/001_schema.sql`
- `database/init/002_seed.sql`

连接信息：

```text
Host: localhost
Port: 5433
Database: knowledgehub
Username: knowledgehub
Password: knowledgehub_dev_password
```

示例密码仅用于本地开发，生产环境必须替换。

## 验证数据库

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-db.ps1
```

测试在事务中创建用户、应用、知识库、会话和消息，并验证所有者隔离与消息序号唯一约束；结束时会回滚，不残留测试数据。

## 常用命令

```powershell
# 查看状态
docker compose ps

# 查看数据库日志
docker compose logs db

# 进入 psql
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# 停止服务
docker compose down
```

## 当前目录

```text
database/
  init/       建表与种子脚本
  tests/      数据库冒烟测试
apps/
  api/        Express API、认证与业务服务
  web/        Next.js 管理工作台
docs/         设计说明
scripts/      本地开发脚本
compose.yaml  PostgreSQL 开发环境
```

数据库设计和关键取舍见 `docs/database-design.md`。

## Node.js API

```powershell
npm.cmd install
npm.cmd run db:migrate
npm.cmd run dev:api
```

API 默认监听 `http://localhost:3001`，健康检查地址为 `http://localhost:3001/health`。

```powershell
npm.cmd run typecheck
npm.cmd run test:api
npm.cmd run build:api
```

接口列表与请求示例见 `docs/api.md`。

## Next.js Web

```powershell
npm.cmd run dev:web
```

Web 工作台默认监听 `http://localhost:3000`，通过同源 Route Handler 访问 API。访问令牌和刷新令牌保存在 `HttpOnly` Cookie 中，不会暴露给浏览器端 JavaScript。

生产构建：

```powershell
npm.cmd run build:web
npm.cmd run start --workspace @knowledgehub/web
```

当前页面包括注册、邮箱验证、登录、安全找回密码、会话恢复、平台总览，以及 AI 应用、知识库、对话记录、成员管理和账户设置工作台。总览是登录后的默认入口，聚合资源统计、应用知识库关联覆盖、近 7 天对话/消息活跃度和最近动态。应用与知识库支持概况统计、搜索、状态筛选、排序、分页、创建、编辑、停用与双向关联管理；知识库详情继续管理文件、URL 和文本来源的文档记录、解析状态及 FastGPT Collection ID，并可搜索、预览和维护有序正文分块。文档支持粘贴正文或读取 TXT、Markdown、CSV、JSON、HTML 文本文件，服务端按可配置长度与重叠量生成预览，确认后在一个事务内替换原有分块并计算字节数与 SHA-256；分块数由数据库触发器自动同步。知识库检索测试台使用 PostgreSQL `pg_trgm` 对全部就绪文档执行中文精确与模糊检索，支持最低相关度和返回数量调节，并展示来源文档、分块位置、命中方式、分数与耗时。AI 应用的 FastGPT API Key 使用 AES-256-GCM 加密后保存，接口只返回配置状态。对话详情可直接向配置好的 FastGPT 应用发送测试消息，服务端提交最近上下文并把成功结果、模型、Token、耗时或失败状态完整落库；同一对话只允许一个生成任务，页面刷新后也会继续锁定输入区，最新失败回复可在原消息上重试并保留历史错误与重试次数，浏览器始终接触不到明文密钥。对话记录同时支持应用筛选、消息正文搜索、创建、重命名、归档、恢复和完整消息时间线。账户设置支持维护显示名称、修改密码，以及查看每个活跃登录的设备类型、客户端、IP、登录时间、最近活动和到期时间；用户可单独退出某个设备或退出全部设备，改密与全部退出仍会撤销该账号的所有刷新会话。所有工作台数据均按当前用户隔离，前端令牌由同源 BFF 和 `HttpOnly` Cookie 管理。

成员管理仅对管理员显示。空系统的首位活跃账号自动成为管理员，后续账号默认为普通成员；管理员可搜索和筛选成员、查看邮箱/MFA/会话状态、调整角色并启停账号。系统禁止管理员修改自己的角色或状态，并保证至少保留一位启用中的管理员；角色和状态变更会立即撤销目标账号全部设备会话并写入安全活动。

设置页提供安全活动时间线，记录注册、登录成功/失败、资料与密码变更、会话撤销和主动退出，但不保存密码、令牌或请求正文。

新账号必须先验证登录邮箱。注册和重发都会创建 48 字节一次性随机令牌，数据库只保存 SHA-256 哈希，默认 24 小时过期；新链接会作废旧链接，重复或并发确认只有一次成功。验证前即使密码正确也不会创建访问令牌、刷新令牌或设备会话。重发接口对未知、已验证和待验证邮箱返回相同结果，降低账号枚举风险；历史账号在迁移时自动标记为已验证。

账户可启用基于 TOTP 的双重验证，兼容常见验证器应用。启用前需要重新验证当前密码并扫描一次性二维码；TOTP 密钥使用 AES-256-GCM 加密保存。密码验证通过后仅签发 5 分钟、最多 5 次尝试的一次性 MFA 挑战，第二步成功前不会创建登录会话。系统同时生成 10 个一次性恢复码，数据库只保存 SHA-256 哈希；用户可在设置页复制、下载或更新恢复码，也可使用验证器或恢复码安全关闭双重验证。相关操作会撤销当前设备之外的活跃会话并进入安全活动。

账号异常登录保护默认在 15 分钟窗口内连续失败 5 次后锁定 15 分钟，成功登录或修改密码后自动清零。锁定、拦截与自动解锁都会进入安全活动，设置页会展示当前保护策略和状态。

访问令牌与数据库设备会话实时联动：主动退出、修改密码、撤销单个设备或退出全部设备后，已签发的旧访问令牌也会立即失效。受保护请求会以一分钟节流更新设备最近活动时间。

刷新令牌每次使用都会轮换，已轮换令牌的哈希保留至其原到期时间。若旧令牌被再次使用，系统会将其识别为潜在会话凭据泄露，立即撤销对应设备的最新会话并写入安全活动；随机无效令牌仍使用通用错误响应。

忘记密码流程始终返回相同受理结果以降低账号枚举风险。一次性随机令牌只通过邮件发送，数据库仅保存 SHA-256 哈希，默认 30 分钟过期且新请求会作废旧链接。重置仍执行强密码和近期密码规则；成功后原子消费全部重置链接、撤销全部设备会话并写入安全活动。

注册与修改密码都必须达到“强”等级：12-72 个字符且不超过 72 个 UTF-8 字节，在大小写字母、数字和符号中至少包含三类，并拒绝常见模式、连续/重复字符及包含姓名或邮箱前缀的密码。注册页、账户设置页与 API 使用同一套规则，登录仍兼容策略升级前创建的账号。修改密码时默认禁止重复使用当前及最近 4 个历史密码；保留数量可通过 `PASSWORD_HISTORY_LIMIT` 在 2-10 之间配置，数据库只保存 bcrypt 哈希。

生产环境必须将 `DATA_ENCRYPTION_KEY` 替换为独立的 64 位十六进制随机值，并在已有密文的生命周期内安全保存该密钥。可使用 `openssl rand -hex 32` 生成。
