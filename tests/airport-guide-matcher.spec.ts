import { expect, test } from "@playwright/test";
import { recognizeAirportForOrder, type AirportGuideMatchCandidate } from "../src/features/airport-guides/matcher";

const guides: AirportGuideMatchCandidate[] = [
  { id: "bkk-active", airportName: "Suvarnabhumi Airport", iataCode: "BKK", terminal: null, isActive: true, aliases: [{ matchKind: "ALIAS", normalizedValue: "suvarnabhumi" }, { matchKind: "ADDRESS_KEYWORD", normalizedValue: "bangkok international airport" }] },
  { id: "dmk-inactive", airportName: "Don Mueang Airport", iataCode: "DMK", terminal: null, isActive: false, aliases: [{ matchKind: "ALIAS", normalizedValue: "don mueang" }] },
];

test("机场识别优先使用 IATA，并只对接机给出有效指引", () => {
  expect(recognizeAirportForOrder({ pickupAddress: "BKK Airport, Gate 4", dropoffAddress: "Sukhumvit, Bangkok", guides })).toEqual({ kind: "AIRPORT_PICKUP_MATCHED", airportName: "Suvarnabhumi Airport", guideId: "bkk-active", matchedBy: "IATA" });
});

test("已知机场但没有有效版本时明确提示缺少指引", () => {
  expect(recognizeAirportForOrder({ pickupAddress: "Don Mueang International Airport (DMK)", dropoffAddress: "Bangkok", guides })).toEqual({ kind: "AIRPORT_PICKUP_GUIDE_MISSING", airportName: "Don Mueang Airport", matchedBy: "IATA" });
});

test("送机与未知机场地址不会被猜成接机指引", () => {
  expect(recognizeAirportForOrder({ pickupAddress: "Sukhumvit, Bangkok", dropoffAddress: "Suvarnabhumi Airport (BKK)", guides })).toEqual({ kind: "AIRPORT_DROPOFF", airportName: "Suvarnabhumi Airport" });
  expect(recognizeAirportForOrder({ pickupAddress: "International Airport Terminal", dropoffAddress: "Bangkok", guides })).toEqual({ kind: "AIRPORT_LIKE_UNRESOLVED", reason: "UNKNOWN_AIRPORT" });
});
