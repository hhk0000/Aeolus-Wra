# Word 报告模板发布与回退

首个内置模板为 `mesoscale/1.0.0`。入口为「报告预览 → 报告类型 → 前期中尺度评估」。模板由后端随包分发，不依赖桌面文件。报告按当前请求生成，不写入或修改原始 TXT。可研导出沿用原入口。

## 三个本地版本节点

| Git 标签 | 内容 |
| --- | --- |
| report-mesoscale/pre-v1 | 平台接入前的版本 ca4c849 |
| report-mesoscale/template-v1.0.0 | 已去除批注的模板、发布脚本和初始清单 |
| report-mesoscale/platform-v1.0.0 | 可以上传数据并导出报告的首版平台 |

## 更新现有模板

1. 从平台下载对应版本的无批注模板，在副本上编辑。保留需要自动写入的【字段】、图形名称和表格结构。当前处理器通过图形名称绑定图，通过第1至8张表的位置和行列结构绑定表格。
2. 从项目根目录运行 `.venv\Scripts\python scripts/publish_report_template.py 新模板.docx mesoscale 1.0.1`。脚本清理 Word 批注并输出 SHA-256；版本号不可覆盖。此前版本与批注源稿均保留。
3. 在 `backend/src/wind_platform/report_templates/catalog.json` 的 releases 新增版本、摘要和 renderer。只改文字和版式时可复用 mesoscale-v1；调整表结构、图名称或统计定义时应另建处理器并登记到 `services/report_catalog.py` 的 RENDERERS。先通过指定版本的 source/export 接口验证，再把 active 改为新版本。
4. 用同一份数据对比新旧文件：检查完整自然年、代表年、密度、机组发电量、图宽与边框、批注数和待补字段；运行 `.venv\Scripts\python scripts/check.py` 并在 Word 中复核分页。批准后提交清单和资源，添加新的发布标签。

**只回退模板**时，把 active 切回已验证版本并提交清单；保留所有 releases。界面从接口读取当前版本，已打开的页面仍引用其已选定版本。**回到整个平台的历史状态**时，在单独工作目录使用 `git worktree add --detach ../Aeolus-before-template report-mesoscale/pre-v1`，在该目录按项目 README 安装和构建。切换代码后须重建前端并重新启动离线服务。

## 输入与计算边界

- 接收单点单高度的整点逐小时 TXT。复用资料导入来扫描文件前 200 行，略过说明区，定位时间表头。识别 ERA5 的 Date/Time、Speed_100m、Direction_100m 和格林威治格式的 Date & Time Stamp、CH1Anem125m、CH2Vane125m。平均风速和风向须各唯一一列且高度相等，单位分别为 m/s 和度。SD、Max、Min、温度和气压不参与配对。保留源时间，不根据文件名推断时区。逐行检验时间重复、非整点和数值范围；风速缺值不参与均值。
- 20年均值由最近20个自然年内的有效记录合并计算；近10年取同一窗口后半段。选年按绝对相对偏差，≤2%为平风年；无平风年时取最小偏差，完全并列时取最早年。实际有效记录参与统计，不设覆盖率门槛。
- 项目名、空气密度和选填的经纬度、海拔按一次输入复用。风向玫瑰按有效风向记录，风能玫瑰按同期记录，风能权重按风速立方。代表年拟合复用平台二参数MLE；尚未对标 Windographer 官方算法。无可拟合样本时移除示例拟合图并保留待审字段。
- 可选机组表支持 XLSX（首张工作表第一行为表头，公式需要已保存的计算值）、CSV、TSV。必填列为「序号」「尾流后理论年发电量(MWh)」「单机容量(MW)」。每台年上网电量等于其尾流后理论年电量乘综合修正系数，默认75%。整场等效小时按总净电量除总容量，容量系数暂按8760小时。敏感性口径、极端风速、未提供的地理图和项目资料保留待补，用户校审后交付。
- 源模板通过 `GET /api/v1/reports/templates/{id}/{version}/source` 获取，Word 导出为同一路径下的 `POST export`。接口校验版本摘要，响应头 X-Report-Template 记录选用版本。

