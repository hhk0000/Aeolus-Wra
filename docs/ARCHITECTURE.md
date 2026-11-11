# 架构基线

采用单仓库、模块化单体，React / TypeScript 前端调用 FastAPI。
独立 Python 计算模块只处理标准化输入、参数和结果，不依赖 HTTP、数据库或 AI 服务。

## 当前实现（T0）

- `backend/src/wind_platform/main.py`：应用装配。
- `backend/src/wind_platform/api/`：HTTP 接口；当前仅健康检查。
- `frontend/src/api.ts`：客户端契约及响应校验。
- `frontend/src/App.tsx`：首页、API 连接状态及重试。
- `scripts/`：启动、检查；VS Code 任务调用相同脚本。
- 前端开发服务器将 `/api` 代理到本机后端，避免扩大 CORS 访问范围。
- API 只监听回环地址；无认证的开发基线不向公网发布。

## 随业务引入

T1 引入 services（业务编排）、domain（业务模型）、ingestion（导入）、storage（存储）、
PostgreSQL / SQLAlchemy / Alembic。T2 引入 quality，T3 引入 analysis。
当前不创建空目录、空数据库表或占位迁移。

PostgreSQL 保存工程元数据、处理规则与成果索引；原始文件独立留存，禁止覆盖。
文件位置通过配置管理，业务层使用存储操作接口，避免依赖具体磁盘路径。
数据量与查询方式明确后再决定标准化时间序列的具体存储布局。

本阶段不实现 Redis、后台任务队列、AI 服务、计费与租户权限。
远程访问前必须实现认证、授权和工程归属检查；多租户上线前验证隔离。

## API

`GET /api/v1/health` 返回：

```json
{"status": "ok", "service": "aeolus-wra", "version": "0.1.0"}
```

此接口仅证明 API 进程可以响应，不检查数据库、存储、数据完整性或计算能力。
未实现的业务接口返回 404。实际 OpenAPI 文档位于 `/docs`。

## 开发依赖约束

ESLint 与 TypeScript ESLint 的传递依赖 minimatch 暂时覆盖到 11.0.7 及以上的 11.x。
原因是 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
披露的模式展开拒绝服务问题；修复起始版本为 11.0.1。
覆盖只影响开发工具，需通过 lint 和构建验证兼容性；上游采用修复版本后移除此覆盖。
