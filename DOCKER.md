# KnowledgeHub Docker 发布

生产容器由 `Dockerfile.api`、`Dockerfile.web` 和 `compose.production.yaml` 组成。API 容器启动前会等待数据库并执行带校验和的迁移；Web 使用 Next.js standalone 产物。两个应用都以非 root 用户运行，启用只读根文件系统和容器健康检查。

完整的生产环境变量、预检、备份、恢复、探针、优雅停机、告警和回滚说明见 [docs/operations.md](docs/operations.md)。快速启动：

```powershell
Copy-Item .env.production.example .env.production
# 编辑并替换所有 CHANGE_ME 值
powershell -ExecutionPolicy Bypass -File .\scripts\preflight-production.ps1
docker compose -f .\compose.production.yaml --env-file .env.production up -d --build
```

镜像构建命令：

```powershell
docker buildx build --platform linux/amd64 --load -t knowledgehub-api:latest -f Dockerfile.api .
docker buildx build --platform linux/amd64 --load -t knowledgehub-web:latest -f Dockerfile.web .
```

不要把 `.env.production`、数据库备份、访问密钥或 FastGPT 凭据提交到 Git。多副本 API 部署前需要把当前进程内存限流器替换为共享限流存储。
