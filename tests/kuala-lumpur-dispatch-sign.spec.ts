import { expect, test } from "@playwright/test";
import { db } from "../src/lib/db";
import { createDispatchPreview, saveDispatchCopy } from "../src/features/dispatch/service";

test("吉隆坡只有从机场接机才显示举牌，单笔、批量及复制内容一致", async () => {
  const base = { serviceDate: "2026-11-14", pickupDateTime: new Date("2026-11-14T04:00:00Z"), city: "吉隆坡", fleet: { name: "测试车队" }, passengerName: "Test Passenger", passengerPhone: "+60 123456789", platformVehicleType: "Sedan", status: "READY_TO_DISPATCH", flightNumber: "MH123", adults: 1, children: 0, meetGreetLine: "Example Sign" };
  const rows = [
    { ...base, id: "arrival", platformOrderNumber: "990001", pickupAddress: "KLIA2 Terminal 2", dropoffAddress: "Kuala Lumpur" },
    { ...base, id: "arrival2", platformOrderNumber: "990002", pickupAddress: "airport Kuala Lumpur International terminal 1", dropoffAddress: "Kuala Lumpur", meetGreetLine: null },
    { ...base, id: "departure", platformOrderNumber: "990003", pickupAddress: "Kuala Lumpur hotel", dropoffAddress: "KUL Airport" },
    { ...base, id: "city", platformOrderNumber: "990004", pickupAddress: "Petaling Jaya", dropoffAddress: "Kuala Lumpur" },
    { ...base, id: "hotel", platformOrderNumber: "990005", pickupAddress: "Hotel near KLIA Terminal 1", dropoffAddress: "Kuala Lumpur" },
    { ...base, id: "unknown", platformOrderNumber: "990006", pickupAddress: "Unknown address", dropoffAddress: "Kuala Lumpur" },
  ];
  const findMany = db.order.findMany, findFleet = db.fleet.findUnique, createBatch = db.dispatchBatch.create;
  let snapshot = "";
  try {
    (db.order as any).findMany = async ({ where }: any) => rows.filter((row) => where.id.in.includes(row.id));
    (db.fleet as any).findUnique = async () => ({ id: "fleet-test" });
    (db.dispatchBatch as any).create = async ({ data }: any) => { snapshot = data.contentSnapshot; return { id: "batch-test" }; };
    const airport = await createDispatchPreview(["arrival"], { includeBatchFooter: false });
    const airportWithoutSign = await createDispatchPreview(["arrival2"], { includeBatchFooter: false });
    expect(airport.text).toContain("Meet with greeting sign Example Sign");
    expect(airportWithoutSign.text).toContain("Meet&Greet");
    for (const id of ["departure", "city", "hotel", "unknown"]) {
      const preview = await createDispatchPreview([id], { includeBatchFooter: false });
      expect(preview.valid).toBe(true);
      expect(preview.text).not.toMatch(/meet\s*(?:&\s*greet|with greeting sign)/i);
    }
    const batch = await createDispatchPreview(rows.map((row) => row.id));
    await saveDispatchCopy(rows.map((row) => row.id));
    expect(batch.valid).toBe(true);
    expect(snapshot).toBe(batch.text);
    expect(batch.text?.match(/Meet(?:&Greet| with greeting sign)/g)).toHaveLength(2);
    expect(rows.every((row) => row.meetGreetLine === "Example Sign" || row.id === "arrival2")).toBe(true);
    rows[0].city = "曼谷"; rows[0].pickupAddress = "Bangkok city";
    expect((await createDispatchPreview(["arrival"], { includeBatchFooter: false })).text).toContain("Meet with greeting sign Example Sign");
    rows[0].city = "苏梅";
    expect((await createDispatchPreview(["arrival"], { includeBatchFooter: false })).text).toContain("Meet with greeting sign Example Sign");
  } finally {
    (db.order as any).findMany = findMany; (db.fleet as any).findUnique = findFleet; (db.dispatchBatch as any).create = createBatch;
  }
});
