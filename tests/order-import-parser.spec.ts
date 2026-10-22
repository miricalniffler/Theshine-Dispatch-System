import { expect, test } from "@playwright/test";
import { parseCompactIwayOrEsfortyOrder, parseIwayLabelledOrder } from "../src/app/api/orders/import/parse/route";

test("可解析 WhatsApp / Telegram 常见的 iWay 紧凑订单，保留空缺字段供人工核对", () => {
  const parsed = parseCompactIwayOrEsfortyOrder(`949 810
DIANA NICOLETA MOCANU (8 pax)
19.10.2026 17:55:00
Minibus
airport Suvarnabhumi
Flight number: VZ343
Bangkok, Jasmine Grande Residence
Meet&Greet`);

  expect(parsed).toMatchObject({
    platformOrderNumber: "949810",
    passengerName: "DIANA NICOLETA MOCANU",
    pickupDateTime: "2026-10-19T17:55",
    platformVehicleType: "Minibus",
    pickupAddress: "airport Suvarnabhumi",
    dropoffAddress: "Bangkok, Jasmine Grande Residence",
    flightNumber: "VZ343",
    adults: 8,
    children: 0,
    meetGreetLine: "Meet&Greet",
  });
  expect(parsed?.passengerPhone).toBe("");
});

test("可解析带 Order 标签和电话的紧凑订单，避免把号码当作乘客姓名", () => {
  const parsed = parseCompactIwayOrEsfortyOrder(`Order: 1 015 534
+66 81 234 5678
SOMCHAI JAI DEE (2 pax)
20/10/2026 09:30
Business class
Suvarnabhumi Airport
Flight: TG102
สุขุมวิท 24, Bangkok`);

  expect(parsed).toMatchObject({
    platformOrderNumber: "1015534",
    passengerName: "SOMCHAI JAI DEE",
    passengerPhone: "+66 81 234 5678",
    pickupDateTime: "2026-10-20T09:30",
    platformVehicleType: "Business class",
    pickupAddress: "Suvarnabhumi Airport",
    dropoffAddress: "สุขุมวิท 24, Bangkok",
    flightNumber: "TG102",
    adults: 2,
  });
});

test("不完整紧凑文本不凭空生成字段", () => {
  const parsed = parseCompactIwayOrEsfortyOrder(`949 810
DIANA NICOLETA MOCANU
19.10.2026 17:55:00
Minibus`);

  expect(parsed).toMatchObject({
    platformOrderNumber: "949810",
    passengerName: "DIANA NICOLETA MOCANU",
    pickupAddress: "",
    dropoffAddress: "",
    flightNumber: "",
    passengerPhone: "",
  });
});

test("可解析 WhatsApp/Telegram 带标签 iWay 消息，未出现的信息保持为空", () => {
  const parsed = parseIwayLabelledOrder(`Order number: 949 810
Passenger: DIANA NICOLETA MOCANU (8 pax)
Phone: +40 712 345 678
Pickup date and time: 19.10.2026 17:55:00
Vehicle type: Minibus
From: Suvarnabhumi Airport
To: Jasmine Grande Residence, Bangkok
Flight number: VZ343
Special requests: Meet&Greet`);

  expect(parsed).toMatchObject({
    platformOrderNumber: "949810",
    passengerName: "DIANA NICOLETA MOCANU",
    passengerPhone: "+40 712 345 678",
    pickupDateTime: "2026-10-19T17:55",
    pickupAddress: "Suvarnabhumi Airport",
    dropoffAddress: "Jasmine Grande Residence, Bangkok",
    platformVehicleType: "Minibus",
    flightNumber: "VZ343",
    adults: 8,
    otherNotes: "Meet&Greet",
  });
});

test("iWay 邮件字段混入页脚文字时，只保留电话号码和真实送达地点", () => {
  const parsed = parseIwayLabelledOrder(`Order number: 1114217
Passenger: Trofimova Daria (2 pax)
Passenger Phone Number: +7 902 997–70–44 newsletter promotion text
Pickup date and time: 23.10.2026 05:30:00
Vehicle type: COMFORT
From: Pattaya South, Pinnacle Grand Jomtien Resort
To: airport Suvarnabhumi Rent a vehicle: () Intercity:
Flight number: none`);

  expect(parsed).toMatchObject({
    platformOrderNumber: "1114217",
    passengerPhone: "+7 902 997-70-44",
    dropoffAddress: "airport Suvarnabhumi",
  });
});
