import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const demoIds = ["ord_001", "ord_002", "ord_003", "ord_004", "ord_005", "ord_006", "ord_007"];
const samples = [
  {
    id: "iway_926739", platformOrderNumber: "926739", city: "苏梅", serviceDate: "2026-07-26", pickupDateTime: new Date("2026-07-26T05:45:00+07:00"),
    pickupAddress: "Mae Nam, W Koh Samui, 4, Tambol Maenam, 1, Tambon Mae Nam, Amphoe Ko Samui, Chang Wat Surat Thani",
    dropoffAddress: "airport Samui International", passengerName: "Mikheeva Viktoriia", passengerPhone: "79096222243", flightNumber: "PG 106", platformVehicleType: "Minivan", adults: 2,
    meetGreetLine: "Meeting tablet: Roman Churkin", otherNotes: "Flight departure: 2026-07-26 08:45:00\nIt is important to meet with a sign - it was paid for by the client",
    rawSource: "New ride #926739\nRide number: #926739\nDate: 26.07\nTime: 05:45\nVehicle class: Minivan\nItinerary:\nFrom: Mae Nam, W Koh Samui, 4, Tambol Maenam, 1, Tambon Mae Nam, Amphoe Ko Samui, Chang Wat Surat Thani\nTo: airport Samui International\nFlight number/train number: PG 106\nDeparture time: 2026-07-26 08:45:00\nNumber of passengers: 2\nClients: Mikheeva Viktoriia, phone 79096222243\nMeeting tablet: Roman Churkin\nIt is important to meet with a sign - it was paid for by the client",
  },
  {
    id: "iway_911033", platformOrderNumber: "911033", city: "苏梅", serviceDate: "2026-07-27", pickupDateTime: new Date("2026-07-27T09:30:00+07:00"),
    pickupAddress: "Chaweng, Malibu Beach Resort, 15/2 Chaweng Beach Rd, Tambon Bo Put, Amphoe Ko Samui, Chang Wat Surat Thani",
    dropoffAddress: "airport Samui International", passengerName: "Safarov Arsen", passengerPhone: "79999714586", flightNumber: null, platformVehicleType: "Minivan", adults: 3,
    meetGreetLine: "Meeting tablet: SAFAROV ARSEN", otherNotes: "Flight departure: 2026-07-27 12:10:00\nIt is important to meet with a sign - it was paid for by the client",
    rawSource: "New ride #911033\nRide number: #911033\nDate: 27.07\nTime: 09:30\nVehicle class: Minivan\nItinerary:\nFrom: Chaweng, Malibu Beach Resort, 15/2 Chaweng Beach Rd, Tambon Bo Put, Amphoe Ko Samui, Chang Wat Surat Thani\nTo: airport Samui International\nDeparture time: 2026-07-27 12:10:00\nNumber of passengers: 3\nClients: Safarov Arsen, phone 79999714586\nMeeting tablet: SAFAROV ARSEN\nIt is important to meet with a sign - it was paid for by the client",
  },
  {
    id: "iway_919455", platformOrderNumber: "919455", city: "苏梅", serviceDate: "2026-07-25", pickupDateTime: new Date("2026-07-25T15:20:00+07:00"),
    pickupAddress: "Chaweng, The Briza Beach Resort, Samui, 173 22 หมู่ที่ 2 Tambon Bo Put, Amphoe Ko Samui, Chang Wat Surat Thani",
    dropoffAddress: "airport Samui International", passengerName: "Sergey Pavlov", passengerPhone: "79119445168", flightNumber: null, platformVehicleType: "Minivan", adults: 4,
    meetGreetLine: "Meeting tablet: Sergey Pavlov", otherNotes: "Flight departure: 2026-07-25 17:50:00\nIt is important to meet with a sign - it was paid for by the client",
    rawSource: "New ride #919455\nRide number: #919455\nDate: 25.07\nTime: 15:20\nVehicle class: Minivan\nItinerary:\nFrom: Chaweng, The Briza Beach Resort, Samui, 173 22 หมู่ที่ 2 Tambon Bo Put, Amphoe Ko Samui, Chang Wat Surat Thani\nTo: airport Samui International\nDeparture time: 2026-07-25 17:50:00\nNumber of passengers: 4\nClients: Sergey Pavlov, phone 79119445168\nMeeting tablet: Sergey Pavlov\nIt is important to meet with a sign - it was paid for by the client",
  },
];

await db.$transaction(async (tx) => {
  await tx.iwayReturnBatch.deleteMany({ where: { orders: { some: { orderId: { in: demoIds } } } } });
  await tx.dispatchBatch.deleteMany({ where: { orders: { some: { orderId: { in: demoIds } } } } });
  await tx.order.deleteMany({ where: { id: { in: demoIds } } });
  for (const sample of samples) {
    await tx.order.upsert({
      where: { platformOrderNumber: sample.platformOrderNumber },
      update: sample,
      create: { ...sample, status: "READY_TO_DISPATCH" },
    });
    await tx.activityLog.create({ data: { orderId: sample.id, action: "从 i’way 飞书邮件样本核验导入", actor: "系统修正", metadata: JSON.stringify({ source: "dingdan@theshine.com.cn", sourceFormat: "iway_new_ride", verified: true }) } });
  }
});

await db.$disconnect();
console.log("Removed 7 demo orders and loaded 3 verified i’way sample orders.");
