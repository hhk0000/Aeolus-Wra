import { useEffect, useState } from "react";

type Template = { id: string; version: string; title: string };
export default function MesoscaleExport({ project }: { project: string }) {
  const [items, setItems] = useState<Template[]>([]);
  const [selected, select] = useState("");
  const [error, fail] = useState("");
  const [withLocation, setWithLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/v1/reports/templates", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw Error("无法加载模板");
        const list: Template[] = await r.json();
        setItems(list);
        select(list[0]?.id ?? "");
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) fail(String(e));
      });
    return () => ctrl.abort();
  }, []);
  const item = items.find((i) => i.id === selected);
  const url = item
    ? `/api/v1/reports/templates/${item.id}/${item.version}`
    : "";
  return (
    <section className="panel">
      <h2>前期中尺度评估</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!item || busy) return;
          const form = new FormData(e.currentTarget);
          if (!(form.get("energy") as File)?.size) form.delete("energy");
          setBusy(true);
          fail("");
          try {
            const r = await fetch(url + "/export", {
              method: "POST",
              body: form,
            });
            if (!r.ok) {
              const body = await r.json();
              throw Error(body.detail || "报告生成失败");
            }
            const href = URL.createObjectURL(await r.blob());
            const a = document.createElement("a");
            a.href = href;
            a.download = project + "中尺度风资源分析报告.docx";
            a.click();
            setTimeout(() => URL.revokeObjectURL(href), 30000);
          } catch (err) {
            fail(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          <label>
            报告模板{" "}
            <select value={selected} onChange={(e) => select(e.target.value)}>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} · {i.version}
                </option>
              ))}
            </select>
          </label>{" "}
          {item && <a href={url + "/source"}>下载无批注模板</a>}
        </p>
        <p>
          <label>
            项目名称 <input name="project" required defaultValue={project} />
          </label>
        </p>
        <p>
          <label>
            单点单高度逐小时 TXT{" "}
            <input name="data" type="file" accept=".txt" required />
          </label>
        </p>
        <p className="ww-inline-note">
          自动识别 ERA5 和格林威治 TXT
          的表头及分析高度。风速与风向须为同一高度，长期评估仍需 20 年资料。
        </p>
        <p>
          <label>
            轮毂高度空气密度（kg/m³）{" "}
            <input
              name="density"
              type="number"
              min="0.001"
              max="2.999"
              step="any"
              required
            />
          </label>
        </p>
        <p>
          <label>
            机组发电量表（可选，XLSX、CSV 或 TSV）{" "}
            <input name="energy" type="file" accept=".xlsx,.csv,.tsv,.txt" />
          </label>
        </p>
        <p>
          机组发电量表须包含「序号」「尾流后理论年发电量(MWh)」「单机容量(MW)」。
        </p>
        <p>
          <label>
            综合修正系数（%）{" "}
            <input
              type="number"
              name="factor"
              min="0.01"
              max="100"
              step="any"
              defaultValue="75"
              required
            />
          </label>
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              checked={withLocation}
              onChange={(e) => setWithLocation(e.target.checked)}
            />
            填写中尺度选点位置
          </label>
        </p>
        {withLocation && (
          <p>
            <label>
              纬度（°）
              <input
                name="lat"
                type="number"
                step="any"
                min="-90"
                max="90"
                required
              />
            </label>{" "}
            <label>
              经度（°）
              <input
                name="lon"
                type="number"
                step="any"
                min="-180"
                max="180"
                required
              />
            </label>{" "}
            <label>
              海拔（m）
              <input name="alt" type="number" step="any" required />
            </label>
          </p>
        )}
        <button disabled={!item || busy}>
          {busy ? "正在计算并生成报告…" : "生成 Word 半成品"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
