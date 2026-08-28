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

当前页面包括注册、登录、会话恢复、平台总览，以及 AI 应用、知识库、对话记录和账户设置工作台。总览是登录后的默认入口，聚合资源统计、应用知识库关联覆盖、近 7 天对话/消息活跃度和最近动态。应用与知识库支持概况统计、搜索、状态筛选、排序、分页、创建、编辑、停用与双向关联管理；知识库详情继续管理文件、URL 和文本来源的文档记录、解析状态及 FastGPT Collection ID，并可搜索、预览和维护有序正文分块。分块数由数据库触发器自动同步。AI 应用的 FastGPT API Key 使用 AES-256-GCM 加密后保存，接口只返回配置状态。对话记录支持应用筛选、消息正文搜索、创建、重命名、归档、恢复和完整消息时间线。账户设置支持维护显示名称、修改密码、查看活跃登录数量和退出所有设备；改密或退出所有设备都会撤销该账号的全部刷新会话。所有工作台数据均按当前用户隔离，前端令牌由同源 BFF 和 `HttpOnly` Cookie 管理。

注册与修改密码都必须达到“强”等级：12-72 个字符且不超过 72 个 UTF-8 字节，在大小写字母、数字和符号中至少包含三类，并拒绝常见模式、连续/重复字符及包含姓名或邮箱前缀的密码。注册页、账户设置页与 API 使用同一套规则，登录仍兼容策略升级前创建的账号。

生产环境必须将 `DATA_ENCRYPTION_KEY` 替换为独立的 64 位十六进制随机值，并在已有密文的生命周期内安全保存该密钥。可使用 `openssl rand -hex 32` 生成。
