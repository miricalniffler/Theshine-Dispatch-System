import { expect, test } from "@playwright/test";
import { db } from "../src/lib/db";
import { getIwayVehicleGate, reassessOrder, releaseOrderVehicle } from "../src/features/vehicle-monitoring/assessment-service";
import { confirmIwayReturn, createIwayPreview, saveDriverDetails, saveIwayCopy } from "../src/features/iway/service";
import { reviewAiVehicleCandidate } from "../src/features/vehicle-monitoring/ai-candidates";

// This suite is opt-in. It runs only against the disposable Neon branch
// created for PR #44; it must never be pointed at a shared or production DB.
const enabled = process.env.RUN_VEHICLE_MONITORING_DB_INTEGRATION === "1";
const key = `pr44-db-${Date.now()}`;
const orderNo = `PR44-${Date.now()}`;
let orderId = "";
let standardId = "";
let batchId = "";
let candidateId = "";
let aiStandardId = "";

test.describe("vehicle monitoring on an isolated PostgreSQL database", () => {
  test.skip(!enabled, "requires the disposable PR #44 Neon branch");

  test.beforeAll(async () => {
    const standard = await db.vehicleModelStandard.create({ data: {
      sourceKey: key, internalGrade: "测试 7 座", configurationLabel: "独立验收专用", representativeModels: ["Toyota Fortuner"],
      maxPassengers: 6, maxStandardLuggage: 4, countryScopeKey: "TH", countryScopeLabel: "泰国", source: "PR44 integration test", originalRecord: { isolated: true }, isConfirmed: true,
    } });
    standardId = standard.id;
    await db.vehicleModelStandardAlias.create({ data: { vehicleStandardId: standardId, displayName: "Toyota Fortuner", normalizedName: "toyota fortuner" } });
    await db.vehicleCapacityCombination.create({ data: { vehicleStandardId: standardId, passengers: 6, standardLuggage: 4, outcome: "SUPPORTED", downwardCompatible: true, source: "PR44 integration test", isConfirmed: true } });
    await db.platformVehicleGradeRule.create({ data: { platform: "IWAY", platformGrade: "Comfort", countryScopeKey: "TH", countryScopeLabel: "泰国", vehicleStandardId: standardId, outcome: "SUPPORTED", source: "PR44 integration test", isConfirmed: true } });
    const order = await db.order.create({ data: {
      platformOrderNumber: orderNo, city: "Bangkok", serviceDate: "2026-12-20", pickupDateTime: new Date("2026-12-20T02:00:00.000Z"), pickupAddress: "Test airport", dropoffAddress: "Test hotel", passengerName: "PR44 Test", passengerPhone: "+66000000000", platformVehicleType: "Comfort", adults: 6, children: 0, luggage: 2, luggageSource: "ACTUAL", serviceCountry: "TH", status: "DISPATCHED",
    } });
    orderId = order.id;
    await saveDriverDetails(orderId, { rawReply: "isolated integration test", confirmedDriverName: "PR44 Driver", rawDriverPhone: "0812345678", confirmedVehicleModel: "Toyota Fortuner", confirmedVehicleCategory: "SUV", licensePlate: "ทดสอบ 44", skipArchiveHistory: true });
  });

  test.afterAll(async () => {
    if (!standardId) return;
    if (batchId) {
      await db.iwayReturnBatchOrder.deleteMany({ where: { orderId } });
      await db.iwayReturnBatch.deleteMany({ where: { id: batchId } });
    }
    await db.orderVehicleOverride.deleteMany({ where: { orderId } });
    await db.orderVehicleAssessment.deleteMany({ where: { orderId } });
    await db.orderDriverVehicleAssignment.deleteMany({ where: { orderId } });
    await db.driverDetail.deleteMany({ where: { orderId } });
    await db.activityLog.deleteMany({ where: { orderId } });
    await db.order.deleteMany({ where: { id: orderId } });
    if (aiStandardId) {
      await db.vehicleStandardAudit.deleteMany({ where: { vehicleStandardId: aiStandardId } });
      await db.platformVehicleGradeRule.deleteMany({ where: { vehicleStandardId: aiStandardId } });
      await db.vehicleCapacityCombination.deleteMany({ where: { vehicleStandardId: aiStandardId } });
      await db.vehicleModelStandardAlias.deleteMany({ where: { vehicleStandardId: aiStandardId } });
      await db.vehicleModelStandard.deleteMany({ where: { id: aiStandardId } });
    }
    if (candidateId) await db.aiVehicleCandidate.deleteMany({ where: { id: candidateId } });
    await db.platformVehicleGradeRule.deleteMany({ where: { vehicleStandardId: standardId } });
    await db.vehicleCapacityCombination.deleteMany({ where: { vehicleStandardId: standardId } });
    await db.vehicleModelStandardAlias.deleteMany({ where: { vehicleStandardId: standardId } });
    await db.vehicleModelStandard.deleteMany({ where: { id: standardId } });
    await db.$disconnect();
  });

  test("real DB: capacity, release expiry, and all iWay gates remain server-side", async () => {
    expect((await reassessOrder(orderId, "INTEGRATION_START"))?.status).toBe("COMPLIANT");
    expect((await createIwayPreview([orderId])).valid).toBe(true);

    await db.order.update({ where: { id: orderId }, data: { luggage: 6 } });
    expect((await reassessOrder(orderId, "LUGGAGE_CHANGED"))?.status).toBe("NON_COMPLIANT");
    expect((await getIwayVehicleGate(orderId)).allowed).toBe(false);
    expect((await createIwayPreview([orderId])).valid).toBe(false);

    await releaseOrderVehicle(orderId, "隔离验收：已人工确认本次例外");
    expect((await getIwayVehicleGate(orderId)).allowed).toBe(true);
    const copied = await saveIwayCopy([orderId]);
    expect(copied.valid).toBe(true);
    batchId = (copied as typeof copied & { batchId: string }).batchId;
    expect(batchId).toBeTruthy();

    await db.order.update({ where: { id: orderId }, data: { luggage: 5 } });
    expect((await getIwayVehicleGate(orderId)).allowed).toBe(false);
    await expect(confirmIwayReturn(batchId)).rejects.toThrow("IWAY_PREVIEW_STALE");
  });

  test("real DB: reviewed AI candidate needs human evidence and does not infer an iWay grade", async () => {
    const candidate = await db.aiVehicleCandidate.create({ data: {
      cacheKey: `${key}-candidate`, requestSnapshot: { isolated: true }, provider: "test",
      status: "PENDING_REVIEW", candidates: { fullName: "Toyota Test Cruiser", confidence: 0.51, note: "test candidate" },
    } });
    candidateId = candidate.id;
    const result = await reviewAiVehicleCandidate(candidate.id, {
      action: "SAVE_STANDARD", resolvedName: "Toyota Test Cruiser", actor: "隔离验收",
      standard: { countryScopeKey: "TH", countryScopeLabel: "泰国", internalGrade: "人工核对 SUV", configurationLabel: "7 座标准配置", maxPassengers: 5, maxStandardLuggage: 3, capacityEvidence: "隔离验收车队确认记录", downwardCompatible: true },
    });
    aiStandardId = result.standard!.id;
    expect(result.candidate.status).toBe("STANDARD_CONFIRMED");
    expect(await db.vehicleStandardAudit.count({ where: { vehicleStandardId: aiStandardId, aiCandidateId: candidate.id } })).toBe(1);
    expect(await db.vehicleCapacityCombination.findFirst({ where: { vehicleStandardId: aiStandardId, passengers: 5, standardLuggage: 3, isConfirmed: true } })).toBeTruthy();
    expect(await db.platformVehicleGradeRule.count({ where: { vehicleStandardId: aiStandardId } })).toBe(0);
  });
});
