import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { classifyGmailIwayMessage } from "../src/features/import/gmail-iway-sync";
import { isIwayNewRideEmail, parseIwayNewRide } from "../src/features/import/iway-new-ride-parser";

// Anonymised table-to-plain-text layout observed in the live Gmail message.
const notice = `Dear partners, we send you a new transfer service order
Amendments are marked in red, previous values are struck through
Ride number:
  
9000001
City:
  
Bangkok
Pick-up date:
  
October 31, 2026
Local pick-up time:
  
16:15 (4:15 PM)
Vehicle class:
  
STANDARD ("C")Model cars:1. Toyota Corolla (seats - 3)
Pax:
  
1
Transfer:
  
ibis Bangkok IMPACT, Nonthaburi ⇒ airport Suvarnabhumi
Rent a vehicle:
  
 ()
Intercity:
  

Flight number:
  

Greeting sign:
  
Test Passenger
Additional remarks:
.simple-little-table { FONT-SIZE: 12px; }
PARAMS
Toll roadStrictly prohibited
i’way notes:

Additional services:
The additional services are allowed with the Head Office consent only
Passengers:
  
Test Passenger Phone: +66 800 000 001
Footer in another language`;

function bridge() {
  const context = vm.createContext({});
  vm.runInContext(readFileSync("apps-script/gmail-iway-sync/Code.gs", "utf8"), context);
  return context;
}

test("table transfer notice passes both gates and parses explicit fields", () => {
  expect(isIwayNewRideEmail(notice)).toBe(true);
  expect(bridge().isStructuredNewOrder_(notice)).toBe(true);
  expect(parseIwayNewRide(notice.replace(/\n/g, "\r\n"))).toMatchObject({
    platformOrderNumber: "9000001", pickupDateTime: "2026-10-31T16:15",
    passengerName: "Test Passenger", passengerPhone: "+66 800 000 001",
    pickupAddress: "ibis Bangkok IMPACT, Nonthaburi", dropoffAddress: "airport Suvarnabhumi",
    platformVehicleType: "STANDARD", adults: 1, flightNumber: "", city: "曼谷", serviceTimeZone: "Asia/Bangkok",
    meetGreetLine: "Test Passenger",
  });
});

test("classification retains sender, subject and enable-time guards", () => {
  const mail = { id: "synthetic-transfer", sender: "i'way <control@iwayex.com>", subject: "Transfer service order #9 000 001 (i’way)", receivedAt: "2026-10-30T07:14:00.000Z", text: notice };
  const enabled = "2026-10-29T13:48:02.194Z";
  expect(classifyGmailIwayMessage(mail, enabled)).toMatchObject({ accepted: true });
  for (const subject of ["Transfer service order cancelled", "Transfer service order modified", "Transfer service order amendment"]) {
    expect(classifyGmailIwayMessage({ ...mail, subject }, enabled)).toMatchObject({ accepted: false });
  }
  expect(classifyGmailIwayMessage({ ...mail, sender: "unknown@example.com" }, enabled)).toMatchObject({ accepted: false });
  expect(classifyGmailIwayMessage(mail, "2026-10-31T00:00:00.000Z")).toMatchObject({ accepted: false, reason: "BEFORE_ENABLE_WATERLINE" });
});

test("missing or ambiguous transfer fields fail safely", () => {
  const base = { id: "synthetic", sender: "control@iwayex.com", subject: "Transfer service order", receivedAt: "2026-10-30T07:14:00.000Z" };
  for (const text of [notice.replace("⇒", " / "), notice.replace("Test Passenger Phone: +66 800 000 001", "Test Passenger"), notice.replace("October 31, 2026", "February 31, 2026")]) {
    expect(classifyGmailIwayMessage({ ...base, text }, "2026-10-29T00:00:00.000Z")).toMatchObject({ accepted: false });
  }
  expect(isIwayNewRideEmail(notice.replace("Passengers:", "People:"))).toBe(false);
  expect(bridge().isStructuredNewOrder_(notice.replace("Passengers:", "People:"))).toBe(false);
});
