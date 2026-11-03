import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// This is deliberately not a general fleet editor. It is a one-time, exact
// bootstrap for the canonical fleet required before the read-only-safe local
// Feishu recovery helper can create Kuala Lumpur orders.
const fleet = { name: "吉隆坡车队", city: "吉隆坡" };
const apply = process.argv.includes("--apply");
const db = new PrismaClient();

async function main() {
  const existing = await db.fleet.findUnique({ where: { name_city: fleet } });
  if (existing) {
    console.log(JSON.stringify({ status: "already-exists", city: fleet.city }));
    return;
  }
  if (!apply) {
    console.log(JSON.stringify({ status: "would-create", city: fleet.city }));
    return;
  }
  await db.fleet.create({ data: { ...fleet, isActive: true } });
  console.log(JSON.stringify({ status: "created", city: fleet.city }));
}

main().finally(async () => db.$disconnect());
