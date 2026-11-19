import type { SourceKind } from "./model";

export function sourceKindFromFilename(filename: string): SourceKind | "" {
  const name = filename.replace(/\.[^.]+$/, "").normalize("NFKC");
  const candidates: SourceKind[] = [];
  if (/中尺度|长期参考|再分析|era5(?:-land)?|merra[-_ ]?2|wrf/i.test(name))
    candidates.push("reference");
  if (
    /外推|代表年|订正|^\d*[\s_-]*结果数据|\b(?:result|corrected|extrapolated)\b/i.test(
      name,
    )
  )
    candidates.push("result");
  if (/质控|质量控制|删除标记|清洗|\b(?:qc|quality[-_ ]?control)\b/i.test(name))
    candidates.push("qc");
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return "";
  return /原始数据|原始测风|\braw\b/i.test(name) ? "raw" : "";
}

export function sameFile(
  a: { name: string; size: number; lastModified: number },
  b: { name: string; size: number; lastModified: number },
) {
  return (
    a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
  );
}
