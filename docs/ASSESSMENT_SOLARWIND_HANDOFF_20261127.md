# 2026-11-27 · Codex · SolarWind 中尺度 TXT 导入

基线为 `codex/assessment-header-detection-20261127@e2467bd`。修订留在同一本地分支，交付提交为该分支首次包含本文档的提交，未推送。Word 模板为 `mesoscale/1.3.4`。

| 事项 | 规则及原因 | 边界 |
| --- | --- | --- |
| 风向高度和单位 | 用本机 SolarWind 原文件复现报错，表头正确定位在第 11 行。识别 `Direction_100 [degrees]` 中明确写出的 100 m 风向高度，并接受 `degrees`。 | 保留最高风速层与风向同高、列唯一的校验。风向高度不同仍报错。搜索表头仍只查前 13 行。 |
| 数据列分隔 | SolarWind 文件表头是制表符，数据行可用连续空格对齐。识别到该表头和空格数据行时，使用至少两个空格拆分数据。 | 各行列数必须与表头匹配，缺列时报原文件行号。正常制表符文件沿用原分隔逻辑。 |

代码位于 `backend/src/wind_platform/services/mesoscale_report.py` 的 `_read_hourly`。使用两份 SolarWind ERA5（100 m）、两份 SolarWind MERRA2（50 m）原始数据核对，四份均成功读取为 1 小时资料，并得到 20 年基准窗口。上传接口回归覆盖两种高度、两种分隔方式及错高度、缺列错误。原始文件未修改。
