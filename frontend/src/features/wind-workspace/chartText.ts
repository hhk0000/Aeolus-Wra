import { createContext, useContext } from "react";

export const ChartTextScale = createContext(1);

export function useChartTextSize() {
  const scale = useContext(ChartTextScale);
  return (base: number) => Math.round(base * scale);
}
