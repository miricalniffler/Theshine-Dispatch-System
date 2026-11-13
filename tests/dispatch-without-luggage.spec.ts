import { test, expect } from "@playwright/test";
import { db } from "../src/lib/db";
import { createDispatchPreview, saveDispatchCopy } from "../src/features/dispatch/service";

test.describe.configure({ mode: "serial" });

for (const city of ["曼谷", "苏梅", "吉隆坡"]) test(`${city} 单笔和批量派单保留乘客人数且不输出行李`, async () => {
  const orderRows = [1, 2].map((n) => ({ id: `order-${n}`, platformOrderNumber: `990000${n}`, serviceDate: "2026-11-14", pickupDateTime: new Date("2026-11-14T04:00:00Z"), city, fleet: { name: "测试车队" }, passengerName: `Test Passenger ${n}`, passengerPhone: "+66 812345678", platformVehicleType: "Comfort", status: "READY_TO_DISPATCH", pickupAddress: "Test pickup", dropoffAddress: "Test destination", flightNumber: null, adults: 2, children: 1, luggage: 8, meetGreetLine: "Meet&Greet" }));
  const findMany = db.order.findMany, findFleet = db.fleet.findUnique, createBatch = db.dispatchBatch.create;
  let snapshot = "";
  try {
    (db.order as any).findMany = async ({ where }: any) => orderRows.filter((row) => where.id.in.includes(row.id));
    (db.fleet as any).findUnique = async () => ({ id: "fleet-test" });
    (db.dispatchBatch as any).create = async ({ data }: any) => { snapshot = data.contentSnapshot; return { id: "batch-test" }; };
    const single = await createDispatchPreview(["order-1"], { includeBatchFooter: false });
    const batch = await createDispatchPreview(["order-1", "order-2"]);
    const copy = await saveDispatchCopy(["order-1", "order-2"]);
    expect(single.valid).toBe(true); expect(batch.valid).toBe(true); expect(copy.valid).toBe(true);
    for (const text of [single.text, batch.text, snapshot]) {
      expect(text).toContain("Passenger Count: Children: 1; Adults: 2");
      expect(text).not.toMatch(/luggage|baggage|行李/i);
    }
    expect(batch.text).toContain("9900001"); expect(batch.text).toContain("9900002");
    expect(orderRows.map((row) => row.luggage)).toEqual([8, 8]);
  } finally {
    (db.order as any).findMany = findMany; (db.fleet as any).findUnique = findFleet; (db.dispatchBatch as any).create = createBatch;
  }
});
