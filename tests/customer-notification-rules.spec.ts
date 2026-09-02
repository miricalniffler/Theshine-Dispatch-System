import { expect, test } from "@playwright/test";
import { normalizeCustomerPhone, parseSimpleReply } from "../src/features/customer-notifications/service";

test("only accepts an explicit international customer number", () => {
  expect(normalizeCustomerPhone("+7 707 940 6012")).toBe("77079406012");
  expect(normalizeCustomerPhone("00380 50 732 9625")).toBe("380507329625");
  expect(normalizeCustomerPhone("0645093264")).toBeNull();
});

test("parses a simple confirmation and luggage without AI", () => {
  expect(parseSimpleReply("Yes, everything is correct. We have 3 large suitcases and 2 carry-on bags.")).toMatchObject({ parser: "RULE", confirmation: "CONFIRMED", largeSuitcases: 3, carryOnBags: 2, needsReview: false });
});

test("keeps unclear text for the guarded AI/manual path", () => {
  expect(parseSimpleReply("Could you please check it again?")) .toBeNull();
});
