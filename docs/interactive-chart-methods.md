# 交互图表口径

2026-11-13项目负责人明确：完整年数据量默认采用365天，每日144个十分钟格，共52560格。日历覆盖与数据量判据分别显示；原有按日历应测格的统计保留以供对照。完整年QC有效数量来自所选分析时段，分母按固定365天计算，不因闰年自动增加。原数据和旧运行快照不可变。

Weibull保留既有MLE实现；新增正风速条件拟合：累计概率最小二乘（绘图位置(i-0.3)/(n+0.4)）、矩估计（匹配均值与方差）和能量匹配（匹配均值与三阶矩）。零值质量单列，各箱概率由CDF差求得，末箱保留尾概率。新增方法属于补充统计方法，不标为国标指定算法。算法切换调用本机服务重算并保存新运行。

IEC参考默认按61400-1第3版NTM代表湍流曲线 Iref*(0.75+5.6/V)；A/B/C的Iref分别0.16/0.14/0.12。S为自定义输入，示例默认0.18不代表IEC规定固定S曲线。平均、TI标准差、特征、代表TI可以分别勾选；比较NTM时应选代表TI。IEC第4版A+不冒称S。

参考：

- [UL Windographer Weibull Fit Algorithms](https://support.ul-renewables.com/windographer/articles-weibull-fit-algorithms.htm)
- [UL IEC Turbulence Modeling](https://support.ul-renewables.com/windographer/articles-IEC-turbulence.htm)
- [UL Turbulence Window](https://support.ul-renewables.com/windographer/dlg-analyze-turbulence.htm)

报告默认导出当前运行的已计算成果；也可把图上当前算法、扇区与显隐配置加入报告后跨图选择导出。HTML图表报告及SVG为当前可用格式，原有可研Word模板套版仍需单独接入，不能视为已完成。原表格CSV与旧运行快照继续可读。
