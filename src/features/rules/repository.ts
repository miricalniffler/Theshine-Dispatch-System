import fs from "node:fs";
import path from "node:path";
import type { RuleVersion } from "@prisma/client";
import { db } from "@/lib/db";
import { loadRulesSource, parseRules } from "@/lib/rules/load-rules";

const rulesPath = path.join(process.cwd(), "config", "business-rules.yaml");

export type PublishedRule = Pick<RuleVersion, "id" | "version" | "yamlContent" | "isCurrent" | "publishedBy" | "publishedAt">;

function toPublishedRule(row: RuleVersion): PublishedRule {
  return {
    id: row.id,
    version: row.version,
    yamlContent: row.yamlContent,
    isCurrent: row.isCurrent,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
  };
}

/**
 * First use imports the checked-in YAML as a snapshot. Later reads always use
 * that snapshot, so an old published rule can never be changed in place.
 */
export async function ensureCurrentRuleVersion(): Promise<PublishedRule> {
  const current = await db.ruleVersion.findFirst({ where: { isCurrent: true }, orderBy: { publishedAt: "desc" } });
  if (current) return toPublishedRule(current);

  const source = loadRulesSource();
  const config = parseRules(source);
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.ruleVersion.findUnique({ where: { version: config.rules_version } });
    await tx.ruleVersion.updateMany({ data: { isCurrent: false } });
    return existing
      ? tx.ruleVersion.update({ where: { id: existing.id }, data: { isCurrent: true } })
      : tx.ruleVersion.create({ data: { version: config.rules_version, yamlContent: source, isCurrent: true, publishedBy: "系统初始化" } });
  });
  return toPublishedRule(result);
}

export async function listRuleVersions(): Promise<PublishedRule[]> {
  await ensureCurrentRuleVersion();
  const rows = await db.ruleVersion.findMany({ orderBy: { publishedAt: "desc" } });
  return rows.map(toPublishedRule);
}

function writeActiveRules(source: string) {
  const temporaryPath = `${rulesPath}.next`;
  fs.writeFileSync(temporaryPath, source, "utf8");
  fs.renameSync(temporaryPath, rulesPath);
}

export async function publishRuleVersion(source: string, publishedBy?: string): Promise<PublishedRule> {
  const config = parseRules(source);
  const exists = await db.ruleVersion.findUnique({ where: { version: config.rules_version } });
  if (exists) throw new Error(`规则版本 ${config.rules_version} 已存在。请先在 YAML 中更新 rules_version 后再发布。`);

  const created = await db.$transaction(async (tx) => {
    await tx.ruleVersion.updateMany({ data: { isCurrent: false } });
    return tx.ruleVersion.create({
      data: { version: config.rules_version, yamlContent: source, isCurrent: true, publishedBy: publishedBy?.trim() || "运营人员" },
    });
  });

  try {
    // The workflow remains YAML-driven: this is the active YAML consumed by
    // dispatch and i’way generation. Database rows are immutable snapshots.
    writeActiveRules(source);
  } catch (error) {
    await db.$transaction(async (tx) => {
      await tx.ruleVersion.delete({ where: { id: created.id } });
      const previous = await tx.ruleVersion.findFirst({ orderBy: { publishedAt: "desc" } });
      if (previous) await tx.ruleVersion.update({ where: { id: previous.id }, data: { isCurrent: true } });
    });
    throw error;
  }
  return toPublishedRule(created);
}
