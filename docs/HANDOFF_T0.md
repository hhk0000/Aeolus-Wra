# T0 开发交接

- **任务目标**：让负责人在 VS Code 查看真实开发文件，并交付可运行的最小前后端基线。
- **当前状态**：本机安装、启动、检查及浏览器验证完成；通过 PR 交付，等待审查。
- **Git 分支及基准提交**：`feature/bootstrap`，基于 `4d7650d`（仓库忽略规则初始化）。
- **修改文件**：`backend/`、`frontend/`、`tests/test_health.py`、`scripts/`、
  `.vscode/`、`.github/workflows/ci.yml`、`.gitattributes`、README 及本批 docs 文档。
- **主要实现**：FastAPI 健康接口、React 工作台、实际连接状态及重试、依赖锁定、
  启动/检查脚本、VS Code 任务和 CI。
- **接口与数据结构变更**：新增 `GET /api/v1/health`；尚无业务数据库模型。

## 实际验证

命令 `.venv\Scripts\python.exe scripts/check.py` 返回 0：

- Ruff 检查和格式检查通过。
- Pytest：3 passed；Starlette 对 httpx 测试客户端有一条上游弃用提示，未屏蔽。
- ESLint、Prettier、TypeScript 类型检查和 Vite 生产构建通过。
- `python -m pip check`：No broken requirements found。
- 最终 npm 安装审计报告：0 vulnerabilities。
- 启动 `scripts/dev.py` 后，真实请求前端代理 `/api/v1/health` 返回
  `{"status":"ok","service":"aeolus-wra","version":"0.1.0"}`。
- 浏览器实际打开首页，显示“API 已连接 · v0.1.0”；点击“重新检查”后恢复该状态。
  已检查桌面截图；未执行移动端、服务断连场景或压力测试。
- 本机 VS Code 1.145.2 已打开项目，官方 `openai.chatgpt` 扩展已安装。
  当前操作通过共享本地文件进行，未宣称桌面会话已迁移到扩展。

## 已知边界与下一步

- 原有 `AGENTS.md` 和 `NUL` 在本次开发前已存在；未改写或提交。
  `AGENTS.md` 中关于空仓库的说明已过时，后续应由负责人确认后更新为正式协作规则。
- 数据库、导入、质控、统计、工程算法尚未实现。T1 先确定样本格式、时间语义、单位及业务模型。
- 数据库连接与业务迁移从 T0 顺延至 T1；本轮不修改本机已有 PostgreSQL 数据。
- 开发依赖 minimatch 的修复覆盖及移除条件见 ARCHITECTURE。
- 本地测试与云端 CI 分开记录；CI 结果以本 PR 的实际检查状态为准。
- 待审查：模块边界、首页与 API 契约、启动脚本、CI；本轮不合并 PR 或发布生产版本。
