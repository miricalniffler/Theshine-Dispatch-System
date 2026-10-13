"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Result = { provider: string; model: string; status: string; text?: string; error?: string; elapsedMs: number; usage?: { inputTokens: number | null; outputTokens: number | null } };
const names: Record<string, string> = { qwen: "Qwen", deepseek: "DeepSeek", glm: "GLM" };
const labels = ["识别正确", "部分正确", "识别错误"] as const;
export default function AiBenchmarkPage() {
  const [mode, setMode] = useState<"vehicle" | "order">("vehicle");
  const [image, setImage] = useState("");
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [truth, setTruth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setResults([]); setRatings({}); }, [mode, image]);
  function loadFile(file?: File) {
    setError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("只支持 JPG、PNG、WebP 图片。"); return; }
    if (file.size > 4 * 1024 * 1024) { setError("图片不能超过 4 MB。"); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") { setImage(reader.result); setFileName(file.name); } };
    reader.readAsDataURL(file);
  }
  async function run() {
    if (!image || busy) return;
    setBusy(true); setError(""); setResults([]); setRatings({});
    try {
      const response = await fetch("/api/ai-benchmark", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: image, mode }), cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "测试失败。");
      setResults(data.results || []);
    } catch (err) { setError(err instanceof Error ? err.message : "请求失败"); }
    finally { setBusy(false); }
  }
  const report = () => [
    "The Shine AI 图片识别模型测试",
    "类型：" + (mode === "vehicle" ? "车辆识别" : "订单识别"),
    "文件：" + fileName,
    "人工标准答案：" + (truth || "未填写"),
    ...results.map(r => [
      "\n模型：" + names[r.provider] + " (" + r.model + ")",
      "状态：" + r.status,
      "耗时：" + (r.elapsedMs / 1000).toFixed(2) + " 秒",
      "Tokens：" + (r.usage ? `${r.usage.inputTokens ?? "?"}/${r.usage.outputTokens ?? "?"}` : "未知"),
      "人工评分：" + (ratings[r.provider] || "未评分"),
      "识别：" + (r.text || r.error || "无"),
    ].join("\n")),
  ].join("\n");
  return <main style={{ maxWidth: 1250, padding: "36px 22px 80px", margin: "0 auto" }}>
    <p style={{ fontSize: 13, color: "#315fe9", fontWeight: 800 }}>THE SHINE / INTERNAL TESTING</p>
    <h1 style={{ fontSize: 30, margin: "6px 0" }}>AI 图片识别对比测试</h1>
    <p style={{ color: "#64748b", lineHeight: 1.7 }}>同一张图片，并行比较 Qwen、DeepSeek、GLM。测试不会创建订单或写入业务数据库。图片会发送给已配置的各家 AI 服务商，请避免上传敏感的真实乘客信息。</p>
    <p><Link href="/orders">← 返回订单页面</Link></p>
    <section style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 14, padding: 20, marginTop: 20 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <button type="button" onClick={() => setMode("vehicle")} aria-pressed={mode === "vehicle"} style={tab(mode === "vehicle")}>车辆车型识别</button>
        <button type="button" onClick={() => setMode("order")} aria-pressed={mode === "order"} style={tab(mode === "order")}>订单截图识别</button>
      </div>
      <label style={{ display: "block", fontWeight: 700, marginBottom: 10 }}>上传测试图片（JPG / PNG / WebP，最多 4 MB）</label>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => loadFile(e.target.files?.[0])} style={{ maxWidth: "100%" }} />
      {image && <div style={{ marginTop: 14 }}><img src={image} alt="上传的测试图片" style={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain", borderRadius: 10 }} /><p style={{ color: "#64748b", fontSize: 13 }}>{fileName}</p></div>}
      <label style={{ display: "block", marginTop: 18, marginBottom: 7, fontWeight: 700 }}>正确答案（可选，用于人工对比）</label>
      <textarea placeholder={mode === "vehicle" ? "例如：Toyota Commuter，2019年以后的车系" : "填写已核实的订单关键信息"} value={truth} onChange={e => setTruth(e.target.value)} rows={2} style={{ width: "100%", borderRadius: 8, border: "1px solid #cbd5e1", padding: 12 }} />
      <button type="button" disabled={!image || busy} onClick={() => void run()} style={{ marginTop: 16, border: 0, borderRadius: 9, background: "#315fe9", color: "#fff", padding: "12px 20px", fontWeight: 800, cursor: "pointer", opacity: !image || busy ? .55 : 1 }}>{busy ? "正在并行识别…" : "开始三模型对比测试"}</button>
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    </section>
    {results.length > 0 && <section style={{ marginTop: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>测试结果</h2>
        <button type="button" onClick={() => void navigator.clipboard.writeText(report())} style={tab(false)}>复制测试报告</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 290px), 1fr))", gap: 14, marginTop: 14 }}>
        {results.map(r => <article key={r.provider} style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 12, padding: 18, minWidth: 0 }}>
          <h3 style={{ margin: "0 0 6px" }}>{names[r.provider]}</h3>
          <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>{r.model} · {r.elapsedMs ? (r.elapsedMs / 1000).toFixed(2) + " 秒" : "未请求"}</p>
          <p style={{ fontSize: 12, color: r.status === "ok" ? "#16835d" : "#a33b24" }}>{r.status === "ok" ? "识别完成" : r.status === "unconfigured" ? "未配置 API Key" : "调用失败"}{r.usage && ` · 输入 ${r.usage.inputTokens ?? "?"} / 输出 ${r.usage.outputTokens ?? "?"} Tokens`}</p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", lineHeight: 1.6, minHeight: 120, background: "#f7f9fc", padding: 12, borderRadius: 9 }}>{r.text || r.error || "未返回内容"}</pre>
          {r.status === "ok" && <div><p style={{ fontSize: 13, fontWeight: 700 }}>人工判定</p><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{labels.map(label => <button key={label} type="button" onClick={() => setRatings(x => ({ ...x, [r.provider]: label }))} style={tab(ratings[r.provider] === label)}>{label}</button>)}</div></div>}
        </article>)}
      </div>
      <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7 }}>Token 用量来自供应商返回的数据；实际费用以各平台账单为准。模型可能在字段或车型上产生错误，请以人工核实为准。评分仅保留在当前页面，复制报告可保存结果。</p>
    </section>}
  </main>;
}
function tab(active: boolean): React.CSSProperties {
  return { padding: "9px 13px", border: "1px solid " + (active ? "#315fe9" : "#cbd5e1"), color: active ? "#fff" : "#25466b", background: active ? "#315fe9" : "#fff", borderRadius: 8, fontWeight: 700, cursor: "pointer" };
}
