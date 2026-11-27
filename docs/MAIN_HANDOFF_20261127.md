# 2026-11-27 · Codex · 主分支集成

按项目负责人指令，将当天已整合的 Aeolus-Wra 风资源评估工作推进到正式仓库的 `main`。主分支原在 `4d7650d`，本次代码基线为 `codex/assessment-header-detection-20261127@046229f`，包含使这些改动能运行的既有平台代码。使用快进合并，保留提交历史。

- 当前启用模板为 `mesoscale/1.3.4`。轮毂高度报告、风向与风能前三扇区、威布尔 k 推荐倍数与 Word 填报规则见 [风资源评估开发交接](WIND_ASSESSMENT_HANDOFF.md)。
- 当天接续改动包括 [前 13 行表头定位](ASSESSMENT_HEADER_LIMIT_HANDOFF_20261127.md)、[SolarWind 导入](ASSESSMENT_SOLARWIND_HANDOFF_20261127.md)、[无风压导出](ASSESSMENT_OPTIONAL_PRESSURE_HANDOFF_20261127.md)、[功率密度纵轴](POWER_DENSITY_AXIS_HANDOFF_20261127.md)、[坐标识别](ASSESSMENT_COORDINATES_HANDOFF_20261127.md)和[轮毂高度输入](HUB_HEIGHT_INPUT_HANDOFF_20261127.md)。
- Gemini、Codex 和 DSH 后续从实际核实的 `origin/main` 开新分支。另有工作分支时先核对祖先关系及未纳入的差异，并按 [协作规则](COLLABORATION.md) 逐轮交接。

默认 SSH 代理当时无法连接。本次使用 GitHub SSH 443 核实远端。此连接选项仅用于当次命令。
