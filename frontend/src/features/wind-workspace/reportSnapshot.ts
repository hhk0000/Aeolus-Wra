export interface ReportTable {
  caption: string;
  headers: string[];
  rows: string[][];
}

export interface ReportSection {
  run_id: string;
  output_id: string;
  title: string;
  html: string;
}

function chartCaption(svg: SVGSVGElement, title: string) {
  const context = svg.closest("article, section");
  const heading = context?.querySelector(
    ":scope > h3, :scope > strong",
  )?.textContent;
  const label = svg.getAttribute("aria-label");
  const caption = label === "真实计算结果图" ? title : label || title;
  return heading && heading !== caption ? `${heading} · ${caption}` : caption;
}

/** Keep the HTML legend with its figure when the SVG becomes a standalone image. */
function copyFigure(svg: SVGSVGElement, title: string) {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = chartCaption(svg, title);
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.removeAttribute("style");
  copy.setAttribute("font-family", "Microsoft YaHei, sans-serif");
  const box = copy.viewBox.baseVal;
  const legend = svg
    .closest("figure")
    ?.querySelectorAll<HTMLElement>(".ww-plot-legend span");
  if (legend?.length && box.width > 0) {
    const base = box.height;
    let x = 32;
    let y = base + 16;
    const measure = document.createElement("canvas").getContext("2d");
    if (measure) measure.font = "15px Microsoft YaHei, sans-serif";
    for (const item of legend) {
      const label = item.textContent?.trim() ?? "";
      const width =
        (measure?.measureText(label).width ?? label.length * 15) + 55;
      if (x > 32 && x + width > box.width - 15) {
        x = 32;
        y += 24;
      }
      const mark = item.querySelector("i");
      const color =
        mark?.style.borderColor || mark?.style.backgroundColor || "#396f58";
      const rect = document.createElementNS(svg.namespaceURI, "rect");
      for (const [attr, value] of Object.entries({
        x,
        y: y - 6,
        width: 20,
        height: mark?.classList.contains("box") ? 8 : 3,
        fill: color,
      })) {
        rect.setAttribute(attr, String(value));
      }
      const text = document.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("x", String(x + 26));
      text.setAttribute("y", String(y));
      text.setAttribute("font-size", "15");
      text.textContent = label;
      copy.append(rect, text);
      x += width;
    }
    copy.setAttribute("viewBox", `0 0 ${box.width} ${y + 12}`);
  }
  figure.append(caption, copy);
  return figure;
}

export function reportSnapshot(root: ParentNode, title: string): string {
  const snapshot = document.createElement("div");
  for (const item of root.querySelectorAll("svg,table")) {
    if (item.closest("details")) continue;
    if (item instanceof SVGSVGElement) {
      snapshot.append(copyFigure(item, title));
      continue;
    }
    const source = item as HTMLTableElement;
    const table = source.cloneNode(true) as HTMLTableElement;
    const section = source.closest("section");
    const heading = section?.querySelector(":scope > h3")?.textContent || title;
    const page = source.closest(".ww-table-scroll")?.nextElementSibling;
    const pagination = page?.matches(".ww-table-pages")
      ? page.querySelector("span")?.textContent
      : "";
    table.createCaption().textContent = pagination
      ? `${heading}（节选，${pagination}）`
      : heading;
    snapshot.append(table);
  }
  return snapshot.innerHTML;
}

export function readTables(root: ParentNode): ReportTable[] {
  return Array.from(root.querySelectorAll("table"), (table) => ({
    caption: table.caption?.textContent ?? "",
    headers: Array.from(
      table.tHead?.rows[0]?.cells ?? [],
      (cell) => cell.textContent ?? "",
    ),
    rows: Array.from(table.tBodies[0]?.rows ?? [], (row) =>
      Array.from(row.cells, (cell) => cell.textContent ?? ""),
    ),
  })).filter((table) => table.headers.length > 0);
}
