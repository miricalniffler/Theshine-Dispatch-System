import { expect, test } from "@playwright/test";
import { isIwayNewRideEmail, parseIwayNewRide } from "../src/features/import/iway-new-ride-parser";

const newRideEmail = `Ride number: 1 114 217
Date: 23.10
Time: 05:30
Vehicle class: C (COMFORT)
Clients: Trofimova Daria, phone +7 902 997–70–44 service update
Number of passengers: 2
Children: 0
Luggage: 2
Itinerary:
From: Suvarnabhumi Airport
To: Sukhumvit 24, Bangkok Rent a vehicle: () Intercity:
Flight number/train number: none
Departure time: 23.10.2026 02:00
Meet&Greet`;

test("只识别结构化 iWay 新订单，并清理邮件页脚混入的字段", () => {
  expect(isIwayNewRideEmail(newRideEmail)).toBe(true);
  expect(parseIwayNewRide(newRideEmail)).toMatchObject({
    platformOrderNumber: "1114217",
    passengerName: "Trofimova Daria",
    passengerPhone: "+7 902 997-70-44",
    pickupDateTime: "2026-10-23T05:30",
    pickupAddress: "Suvarnabhumi Airport",
    dropoffAddress: "Sukhumvit 24, Bangkok",
    platformVehicleType: "COMFORT",
    city: "曼谷",
    adults: 2,
    children: 0,
    luggage: 2,
  });
});

test("不把普通、取消或修改邮件误认作可导入的新订单", () => {
  expect(isIwayNewRideEmail("Order cancelled. Ride number: 1114217")).toBe(false);
  expect(isIwayNewRideEmail("Weekly dispatch information")).toBe(false);
});
