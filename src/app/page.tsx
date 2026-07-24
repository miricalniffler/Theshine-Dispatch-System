import { loadRules } from "@/lib/rules/load-rules";
import Link from "next/link";

const modules = [
  ["01", "订单工作台", "日期筛选、状态概览、多选和异常提醒"],
  ["02", "车队派单", "统一正文；批量结尾按城市规则生成"],
  ["03", "司机资料", "资料确认、电话规范化与车型映射"],
  ["04", "i’way 回传", "同服务日订单合并生成，人工发送后确认"],
  ["05", "规则中心", "YAML 校验、预览、版本和历史快照"],
];

export default function Home() {
  const rules = loadRules();
  return <main className="shell"><header><p className="eyebrow">I’WAY · PHASE ONE</p><h1>接送机发单平台</h1><p className="intro">按服务日整理订单、生成车队派单，再确认司机资料并回传。系统只生成与复制文本，发送始终由人工完成。</p><div className="home-actions"><Link className="home-primary" href="/orders">进入订单工作台</Link><Link className="home-secondary" href="/fleets">管理车队</Link></div></header><section className="rule-card"><span>当前规则版本</span><strong>{rules.rules_version}</strong><span>{rules.timezone}</span></section><section className="grid">{modules.map(([index, title, detail]) => <article key={index}><span>{index}</span><h2>{title}</h2><p>{detail}</p><em>{title === "订单工作台" || title === "车队管理" ? "已可预览" : "开发中"}</em></article>)}</section></main>;
}
