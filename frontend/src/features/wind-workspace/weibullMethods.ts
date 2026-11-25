export const weibullMethods = {
  mle: "最大似然 MLE（默认）",
  "least-squares": "累计概率线性最小二乘",
  moments: "矩估计",
  energy: "均速与能量匹配",
} as const;

export type WeibullMethod = keyof typeof weibullMethods;
