import { test, expect } from "@playwright/test";
import { detectDispatchCity, serviceTimeZoneForCity } from "../src/lib/city/detect-city";
import { normalizeDriverPhone } from "../src/lib/rules/engine";
import { parseIwayNewRide } from "../src/features/import/iway-new-ride-parser";

test("吉隆坡地点须有都会区证据，不能仅凭机场代码归类", () => {
  expect(detectDispatchCity("KLIA Terminal 1", "Kuala Lumpur, Bukit Bintang").city).toBe("吉隆坡");
  expect(detectDispatchCity("KUL", "Unknown hotel").city).toBeNull();
  expect(detectDispatchCity("Kuala Lumpur International Airport", "Petaling Jaya, Malaysia").city).toBe("吉隆坡");
  expect(detectDispatchCity("Bangkok BKK", "Kuala Lumpur, Malaysia").city).toBeNull();
  expect(serviceTimeZoneForCity("吉隆坡")).toBe("Asia/Kuala_Lumpur");
});

test("马来西亚司机电话不会套用泰国区号", () => {
  expect(normalizeDriverPhone("012-345 6789", "吉隆坡")).toBe("+60 123456789");
  expect(normalizeDriverPhone("+60 12 345 6789", "吉隆坡")).toBe("+60 123456789");
  expect(normalizeDriverPhone("0812345678", "吉隆坡")).toBeNull();
  expect(normalizeDriverPhone("0812345678", "曼谷")).toContain("+66");
});

test("iWay 吉隆坡订单沿用结构化解析并使用吉隆坡时区", () => {
  const parsed = parseIwayNewRide(`Ride number: 1163001\nDate: November 10, 2026\nTime: 09:30\nVehicle class: Comfort\nItinerary:\nFrom: KLIA2, Kuala Lumpur International Airport\nTo: Petaling Jaya, Malaysia\nFlight number/train number: MH123\nClients: Lee, phone: +60 12 345 6789\nNumber of passengers: 2\nRemarks:`);
  expect(parsed.city).toBe("吉隆坡");
  expect(parsed.serviceTimeZone).toBe("Asia/Kuala_Lumpur");
  expect(parsed.platformOrderNumber).toBe("1163001");
});

