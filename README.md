# Aeolus-Wra · 风资源自动化分析平台

本地开发起步，逐步演进为云端服务。正式仓库：
[hhk0000/Aeolus-Wra](https://github.com/hhk0000/Aeolus-Wra)。

当前为 **V0.2 风资源分析首版**：四类资料导入、通道确认、风况计算与图表、
相关性、长期周年统计，以及数据审核与序列处理。沿用本地界面设计。
方法来源、适用条件、实现约定及当前边界见[风资源方法说明](docs/WIND_RESOURCE_METHODS.md)。

## 开发环境

- Python 3.12，项目根目录使用独立 `.venv`。
- Node.js 22.12 或以上（本机已使用 Node 26 验证）。
- Windows 使用 `npm.cmd`，无需运行 PowerShell 脚本或修改执行策略。

首次安装（从仓库根目录执行）：

```text
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.lock.txt
.venv\Scripts\python.exe -m pip install --no-deps -e backend
npm.cmd --prefix frontend ci
```

依赖锁文件适用于 Python 3.12。Linux/macOS 将解释器路径替换为 `.venv/bin/python`。
如环境需要网络代理，可在安装命令中显式指定本机代理；代理地址不写入项目配置。

## 启动与查看

```text
.venv\Scripts\python.exe scripts/dev.py
```

打开 <http://127.0.0.1:5173>。脚本同时启动前后端，按 Ctrl+C 停止。
默认只监听本机；端口冲突会报错，不会自动切换到其他端口。

- 前端：<http://127.0.0.1:5173>
- 后端健康检查：<http://127.0.0.1:8000/api/v1/health>
- API 文档：<http://127.0.0.1:8000/docs>

VS Code 打开项目根目录后，使用“终端 → 运行任务 → Aeolus: 启动前后端”。
可分别查看 `frontend/src/App.tsx`、`backend/src/wind_platform/main.py`。
前后端开发服务支持保存后重新加载。

## 检查

```text
.venv\Scripts\python.exe scripts/check.py
```

执行 Python 静态检查、格式检查、API 测试，以及前端 lint、格式检查、类型检查和构建。
CI 执行同样的核心检查。浏览器端端到端检查见交接记录。

## 项目边界

- 架构与当前模块：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 功能里程碑与验收：[docs/PRODUCT.md](docs/PRODUCT.md)
- 数据契约草案：[docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md)
- AI 规则：`AGENTS.md`（当前已有草案，原样保留）

原始工程数据、密钥、日志和生成成果不得提交。当前业务数据分开保存在本机`data/engine`，
尚未接入PostgreSQL；原始文件与派生序列、运行快照独立保存。
健康检查只表示API可响应，具体计算是否可用以运行结果与条件提示为准。
