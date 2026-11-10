import { test, expect } from "@playwright/test";
import { formatGmailSyncCompletedAt, planGmailOrderChanges, rollbackConflicts, type GmailOrderSnapshot } from "../src/features/import/gmail-order-change-plan";

const base: GmailOrderSnapshot = {
  serviceDate: "2026-11-05", pickupDateTime: new Date("2026-11-05T08:00:00Z"),
  pickupAddress: "Airport", dropoffAddress: "Hotel", passengerName: "A",
  passengerPhone: "+601234", flightNumber: null, platformVehicleType: "STANDARD",
  adults: 2, children: 0, luggage: 2, meetGreetLine: null, otherNotes: null,
  status: "READY_TO_DISPATCH",
};

test("Gmail only changes explicitly present values, including intentional null", () => {
  expect(planGmailOrderChanges(base, { platformVehicleType: "MINIVAN", adults: 2 }))
    .toEqual([{ field: "platformVehicleType", before: "STANDARD", after: "MINIVAN" }]);
  expect(planGmailOrderChanges(base, { flightNumber: undefined })).toEqual([]);
  expect(planGmailOrderChanges({ ...base, flightNumber: "TG417" }, { flightNumber: null }))
    .toEqual([{ field: "flightNumber", before: "TG417", after: null }]);
});

test("Gmail rollback detects subsequent manual edits", () => {
  expect(rollbackConflicts({ ...base, passengerPhone: "+60999" }, base)).toEqual(["passengerPhone"]);
  expect(rollbackConflicts(base, base)).toEqual([]);
});

test("Gmail completed timestamp uses local city timezone, not mail receipt time", () => {
  expect(formatGmailSyncCompletedAt("2026-11-05T07:48:08Z", "Asia/Kuala_Lumpur"))
    .toContain("15:48:08");
  expect(formatGmailSyncCompletedAt("2026-11-05T07:48:08Z", "Asia/Bangkok"))
    .toContain("14:48:08");
});
