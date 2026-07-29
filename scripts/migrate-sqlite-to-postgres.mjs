import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const source = "prisma/dev.db";
const tables = [
  ["Fleet", "fleet"],
  ["Order", "order"],
  ["DriverDetail", "driverDetail"],
  ["DispatchBatch", "dispatchBatch"],
  ["DispatchBatchOrder", "dispatchBatchOrder"],
  ["FleetReply", "fleetReply"],
  ["FleetReplyImage", "fleetReplyImage"],
  ["AiExtraction", "aiExtraction"],
  ["DriverDetailConfirmation", "driverDetailConfirmation"],
  ["IwayReturnBatch", "iwayReturnBatch"],
  ["IwayReturnBatchOrder", "iwayReturnBatchOrder"],
  ["RuleVersion", "ruleVersion"],
  ["ActivityLog", "activityLog"],
  ["DuplicateReview", "duplicateReview"],
  ["ImportSyncRun", "importSyncRun"],
  ["ImportedSourceMessage", "importedSourceMessage"],
];

const dateFields = new Set([
  "pickupDateTime", "createdAt", "updatedAt", "confirmedAt", "copiedAt", "uploadedAt",
  "publishedAt", "reviewedAt", "startedAt", "completedAt", "receivedAt", "processedAt",
]);
const booleanFields = new Set(["isActive", "isCurrent"]);

function readRows(table) {
  const output = execFileSync("sqlite3", ["-json", source, `SELECT * FROM "${table}"`], { encoding: "utf8" });
  return JSON.parse(output || "[]");
}

function normalize(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value === null) return [key, value];
    if (dateFields.has(key)) return [key, new Date(value)];
    if (booleanFields.has(key)) return [key, Boolean(value)];
    return [key, value];
  }));
}

const db = new PrismaClient();

try {
  let total = 0;
  for (const [table, model] of tables) {
    const rows = readRows(table).map(normalize);
    if (!rows.length) continue;
    const result = await db[model].createMany({ data: rows, skipDuplicates: true });
    total += result.count;
    console.log(`${table}: ${result.count} 条`);
  }
  console.log(`迁移完成：${total} 条记录。`);
} finally {
  await db.$disconnect();
}
