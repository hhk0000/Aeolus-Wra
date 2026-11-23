import { readTables } from "./reportSnapshot";
import type { ReportSection } from "./reportSnapshot";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[<>:"/\\|?*]/g, "-");
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parse(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

export function downloadHtml(title: string, sections: ReportSection[]) {
  const page = document.implementation.createHTMLDocument(title);
  page.documentElement.lang = "zh-CN";
  const charset = page.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const style = page.createElement("style");
  style.textContent =
    "body{max-width:1100px;margin:32px auto;padding:0 24px;color:#243e30;font:15px/1.5 'Times New Roman',SimSun,'宋体',serif}figure{margin:1em 0;break-inside:avoid}svg{width:100%;max-height:650px}table{border-collapse:collapse;width:100%;margin:1em 0;font-size:11px}td,th{border:1px solid #ccd7d0;padding:5px}caption,figcaption{text-align:left;font-weight:bold}section+section{break-before:page}small{overflow-wrap:anywhere}";
  page.head.prepend(charset, style);
  const heading = page.createElement("h1");
  heading.textContent = title;
  page.body.append(heading);
  for (const section of sections) {
    const container = page.createElement("section");
    const h2 = page.createElement("h2");
    h2.textContent = section.title;
    const source = page.createElement("small");
    source.textContent = `运行 ${section.run_id} · ${section.output_id}`;
    container.append(h2, source, parse(section.html));
    page.body.append(container);
  }
  download(
    new Blob(["<!doctype html>", page.documentElement.outerHTML], {
      type: "text/html;charset=utf-8",
    }),
    `${title}.html`,
  );
}

async function rasterize(svg: SVGSVGElement): Promise<Blob> {
  const image = new Image();
  const box = svg.viewBox.baseVal;
  const width = 1280;
  const height = Math.round((width * box.height) / box.width);
  if (!Number.isFinite(height) || height < 1 || height > 4096)
    throw new Error("图像缺少有效尺寸，无法写入 Word。");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.removeAttribute("style");
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml;charset=utf-8",
    }),
  );
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法生成图像。");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("无法转换图像。"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadWord(
  title: string,
  sections: ReportSection[],
  template: File | null,
  figureWidthPercent: number,
  progress: (message: string) => void,
) {
  const form = new FormData();
  const manifest = [];
  let index = 0;
  for (const section of sections) {
    progress(`正在排版 · ${section.title}`);
    const root = parse(section.html);
    const figures = [];
    for (const svg of root.querySelectorAll("svg")) {
      const caption =
        svg.closest("figure")?.querySelector("figcaption")?.textContent ||
        svg.getAttribute("aria-label") ||
        section.title;
      const blob = await rasterize(svg);
      form.append("images", blob, `figure-${index}.png`);
      figures.push({ index, caption });
      index++;
    }
    const tables = readTables(root);
    manifest.push({
      run_id: section.run_id,
      output_id: section.output_id,
      title: section.title,
      figures,
      ...(tables.length ? { tables } : {}),
    });
  }
  if (template) form.set("template", template);
  form.set(
    "manifest",
    JSON.stringify({
      title,
      sections: manifest,
      figure_width_percent: figureWidthPercent,
    }),
  );
  progress("正在生成 Word 文件…");
  const response = await fetch("/api/v1/reports/docx", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const detail: unknown = (await response.json().catch(() => ({}))).detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `报告生成失败（HTTP ${response.status}）`,
    );
  }
  if (
    !response.headers
      .get("content-type")
      ?.includes(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
  )
    throw new Error("当前服务尚未提供 Word 导出接口。");
  download(await response.blob(), `${title}.docx`);
}
