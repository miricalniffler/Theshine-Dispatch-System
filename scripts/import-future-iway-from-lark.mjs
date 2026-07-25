import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const cli = process.env.LARK_CLI_PATH || "/Users/muzitong/.local/bin/lark-cli";
const mailbox = process.env.IWAY_MAILBOX || "dingdan@theshine.com.cn";
const officialSender = "control@iwayex.com";
const dryRun = process.argv.includes("--dry-run");

function runCli(args) {
  const result = spawnSync(cli, args, {
    cwd: "/Users/muzitong/Documents/帮我装的程序",
    encoding: "utf8",
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `lark-cli exited ${result.status}`);
  return JSON.parse(result.stdout);
}

function normalizedText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function capture(text, pattern) {
  return normalizedText(text.match(pattern)?.[1] || "");
}

function serviceDate(value) {
  const match = value.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return "";
  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const month = months[match[1].toLowerCase()];
  return month ? `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}` : "";
}

function parseOrder(message, meta) {
  const text = normalizedText(message.body_plain_text);
  const orderNo = capture(text, /Ride number:\s*([\d\s]+?)\s+City:/i).replace(/\s/g, "");
  const iwayCity = capture(text, /City:\s*(.*?)\s+Pick-up date:/i);
  const date = serviceDate(capture(text, /Pick-up date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i));
  const pickupTime = capture(text, /Local pick-up time:\s*(\d{1,2}:\d{2})/i);
  const vehicleBlock = capture(text, /Vehicle Class:\s*(.*?)\s+Model cars:/i);
  const vehicleType = vehicleBlock.split("(")[0].trim();
  const modelCars = capture(text, /Model cars:\s*(.*?)\s+Pax:/i);
  const seatCount = Number(modelCars.match(/seats\s*-\s*(\d+)/i)?.[1] || 0) || null;
  const pax = Number(capture(text, /Pax:\s*(\d+)/i)) || 0;
  const transfer = capture(text, /Transfer:\s*(.*?)\s+Flight number:/i);
  const [pickupAddress, dropoffAddress] = transfer.split(/\s*(?:⇒|=>|→)\s*/);
  const rawFlight = capture(text, /Flight number:\s*(.*?)\s+Greeting sign:/i);
  const flightNumber = rawFlight.split("(")[0].replace(/[↓↑]/g, "").trim() || null;
  const greetingSign = capture(text, /Greeting sign:\s*(.*?)\s+Additional remarks:/i);
  const passengerBlock = capture(text, /Passengers:\s*(.*?)\s+Phone:/i);
  const passengers = passengerBlock.split(/\s*,\s*/).map((name) => name.trim()).filter(Boolean);
  const phoneBlock = capture(text, /Phone:\s*(.*?)\s+Please send us a confirmation/i);
  const phones = [...new Set(phoneBlock.split(/\s*,\s*/).map((phone) => phone.trim()).filter(Boolean))];
  const additionalRemarks = capture(text, /Additional remarks:\s*(.*?)\s+i[’']way notes:/i);
  const city = /^(?:koh\s+samui|samui)$/i.test(iwayCity) ? "苏梅" : /^bangkok$/i.test(iwayCity) ? "曼谷" : null;
  if (!orderNo || !city || !date || !pickupTime || !pickupAddress || !dropoffAddress || !passengers.length || !phones.length || !vehicleType) return null;
  return {
    orderNo,
    city,
    serviceDate: date,
    pickupDateTime: new Date(`${date}T${pickupTime.padStart(5, "0")}:00+07:00`),
    pickupAddress: pickupAddress.trim(),
    dropoffAddress: dropoffAddress.trim(),
    passengerName: passengers.join(", "),
    passengerPhone: phones.join(" / "),
    flightNumber,
    platformVehicleType: vehicleType,
    seatCount,
    adults: pax,
    children: 0,
    luggage: pax,
    meetGreetLine: greetingSign || null,
    otherNotes: additionalRemarks || null,
    rawSource: text,
    sourceMessageId: message.message_id,
    sourceSubject: meta.subject,
    receivedAt: new Date(meta.date),
  };
}

function orderNumberFromSubject(subject) {
  return String(subject || "").match(/#?([\d\s\u00a0]{5,})/)?.[1]?.replace(/[\s\u00a0]/g, "") || "";
}

function isCancellationSubject(subject) {
  return /cancel(?:lation|led|ed)?|void/i.test(String(subject || ""));
}

function todayBangkok() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function main() {
  const triage = runCli([
    "mail", "+triage", "--as", "user", "--mailbox", mailbox,
    "--filter", JSON.stringify({ from: [officialSender] }),
    "--max", "400", "--format", "json",
  ]);
  const candidates = triage.messages.filter((mail) =>
    /(?:Transfer service order|AMENDMENT to the transfer|cancel(?:lation|led|ed)?.*transfer|transfer.*cancel(?:lation|led|ed)?)/i.test(mail.subject) &&
    /i[’']way/i.test(mail.subject),
  );
  const uniqueCandidates = [...new Map(candidates.map((mail) => [mail.message_id, mail])).values()];
  const details = runCli([
    "mail", "+messages", "--as", "user", "--mailbox", mailbox,
    "--message-ids", uniqueCandidates.map((mail) => mail.message_id).join(","),
    "--html=false", "--format", "json",
  ]);
  const metadata = new Map(uniqueCandidates.map((mail) => [mail.message_id, mail]));
  const parseResults = details.data.messages.map((message) => {
    const meta = metadata.get(message.message_id);
    if (isCancellationSubject(meta?.subject)) {
      return { message, event: { action: "cancel", orderNo: orderNumberFromSubject(meta.subject), sourceMessageId: message.message_id, sourceSubject: meta.subject, receivedAt: new Date(meta.date) } };
    }
    const order = parseOrder(message, meta);
    return { message, event: order ? { action: "upsert", ...order } : null };
  });
  const rejectedMessages = parseResults.filter((result) => !result.event?.orderNo).map((result) => metadata.get(result.message.message_id));
  const parsed = parseResults.map((result) => result.event).filter((event) => event?.orderNo).sort((left, right) => left.receivedAt - right.receivedAt);
  const latestByOrder = new Map(parsed.map((event) => [event.orderNo, event]));
  const today = todayBangkok();
  const future = [];
  for (const event of latestByOrder.values()) {
    if (event.action === "upsert" && event.serviceDate >= today) future.push(event);
    if (event.action === "cancel") {
      const existing = await db.order.findUnique({ where: { platformOrderNumber: event.orderNo } });
      if (existing?.serviceDate >= today) future.push(event);
    }
  }
  if (dryRun) {
    console.log(JSON.stringify({
      scanned: triage.count,
      candidateMessages: uniqueCandidates.length,
      parsedMessages: parsed.filter((event) => event.action === "upsert").length,
      cancellationMessages: parsed.filter((event) => event.action === "cancel").length,
      rejectedMessages: rejectedMessages.map((mail) => ({ date: mail?.date, subject: mail?.subject, messageId: mail?.message_id })),
      futureOrders: future.map((event) => ({
        action: event.action,
        orderNo: event.orderNo,
        city: event.city,
        serviceDate: event.serviceDate,
        pickupTime: event.pickupDateTime?.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }),
        passengerName: event.passengerName,
        pickupAddress: event.pickupAddress,
        dropoffAddress: event.dropoffAddress,
        sourceSubject: event.sourceSubject,
      })),
    }, null, 2));
    return;
  }
  const fleets = new Map();
  for (const city of ["曼谷", "苏梅"]) {
    const name = `${city}车队`;
    fleets.set(city, await db.fleet.upsert({
      where: { name_city: { name, city } },
      update: { isActive: true },
      create: { name, city, isActive: true, note: JSON.stringify({ chatNote: "", vehicleTypes: [], note: "" }) },
    }));
  }
  const summary = { scanned: triage.count, candidateMessages: uniqueCandidates.length, parsedMessages: parsed.filter((event) => event.action === "upsert").length, cancellationMessages: parsed.filter((event) => event.action === "cancel").length, futureOrders: future.length, created: [], updated: [], cancelled: [], unchanged: [], rejected: rejectedMessages.length };
  for (const item of future) {
    const existing = await db.order.findUnique({ where: { platformOrderNumber: item.orderNo } });
    if (item.action === "cancel") {
      if (existing && existing.status !== "CANCELLED") {
        await db.$transaction([
          db.order.update({ where: { id: existing.id }, data: { status: "CANCELLED" } }),
          db.activityLog.create({ data: { orderId: existing.id, action: "从飞书邮箱同步订单取消", actor: "系统导入", metadata: JSON.stringify({ messageId: item.sourceMessageId, subject: item.sourceSubject }) } }),
        ]);
        summary.cancelled.push(item.orderNo);
      } else {
        summary.unchanged.push(item.orderNo);
      }
      continue;
    }
    const fleet = fleets.get(item.city);
    const data = {
      city: item.city,
      fleetId: fleet.id,
      serviceDate: item.serviceDate,
      pickupDateTime: item.pickupDateTime,
      pickupAddress: item.pickupAddress,
      dropoffAddress: item.dropoffAddress,
      passengerName: item.passengerName,
      passengerPhone: item.passengerPhone,
      flightNumber: item.flightNumber,
      platformVehicleType: item.platformVehicleType,
      seatCount: item.seatCount,
      adults: item.adults,
      children: item.children,
      luggage: item.luggage,
      meetGreetLine: item.meetGreetLine,
      otherNotes: item.otherNotes,
      rawSource: item.rawSource,
    };
    if (existing) {
      const comparable = ["city", "serviceDate", "pickupAddress", "dropoffAddress", "passengerName", "passengerPhone", "flightNumber", "platformVehicleType", "seatCount", "adults", "children", "luggage", "meetGreetLine", "otherNotes"];
      const changed = comparable.some((key) => (existing[key] ?? null) !== (data[key] ?? null)) ||
        existing.pickupDateTime.toISOString() !== data.pickupDateTime.toISOString() || existing.fleetId !== data.fleetId;
      if (changed) {
        await db.$transaction([
          db.order.update({ where: { id: existing.id }, data: { ...data, status: existing.status === "CANCELLED" ? "READY_TO_DISPATCH" : existing.status } }),
          db.activityLog.create({ data: { orderId: existing.id, action: "从飞书邮箱同步订单最新信息", actor: "系统导入", metadata: JSON.stringify({ messageId: item.sourceMessageId, subject: item.sourceSubject }) } }),
        ]);
        summary.updated.push(item.orderNo);
      } else {
        summary.unchanged.push(item.orderNo);
      }
    } else {
      const created = await db.order.create({ data: { platformOrderNumber: item.orderNo, ...data, status: "READY_TO_DISPATCH" } });
      await db.activityLog.create({ data: { orderId: created.id, action: "从飞书邮箱导入未来订单", actor: "系统导入", metadata: JSON.stringify({ messageId: item.sourceMessageId, subject: item.sourceSubject }) } });
      summary.created.push(item.orderNo);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().finally(() => db.$disconnect());
