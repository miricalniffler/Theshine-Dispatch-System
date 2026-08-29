import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const cli = process.env.LARK_CLI_PATH || "/Users/muzitong/.local/bin/lark-cli";
const mailbox = process.env.IWAY_MAILBOX || "dingdan@theshine.com.cn";
const officialSender = "control@iwayex.com";
const newRideSender = "noreply@iway.ru";
const dryRun = process.argv.includes("--dry-run");
const requestedOnly = process.argv.includes("--when-requested");
let syncRequestId = null;

// The local mail bridge can occasionally leave a database or mail request
// waiting forever.  This worker is launched again every minute, so ending a
// stuck run is safer than blocking every later manual refresh.
const watchdog = setTimeout(() => {
  console.error("飞书手动同步超过 120 秒未结束，已停止本次执行，下一分钟会自动重试。");
  process.exit(1);
}, 120_000);

function runCli(args) {
  const result = spawnSync(cli, args, {
    cwd: "/Users/muzitong/Documents/帮我装的程序",
    encoding: "utf8",
    env: {
      ...process.env,
      // LaunchAgent starts with a minimal PATH.  Keep the Node runtime that
      // launched this script available to the lark-cli wrapper as well.
      PATH: `${dirname(process.execPath)}:${process.env.PATH || "/usr/bin:/bin"}`,
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

function cityFromOrder(iwayCity, pickupAddress, dropoffAddress) {
  // i'way 的 City 偶尔填的是错误的行政城市。苏梅的接/送地址比这行字段
  // 更接近实际派车地点，因此只要任一地址明确出现苏梅，就优先归到苏梅。
  const route = `${pickupAddress} ${dropoffAddress}`.toLowerCase();
  if (/\b(?:koh\s+samui|ko\s+samui|samui|chaweng|lamai|bophut|bo\s+phut|surat\s+thani|usm)\b/i.test(route)) return "苏梅";
  if (/^(?:koh\s+samui|ko\s+samui|samui)$/i.test(iwayCity)) return "苏梅";
  if (/^bangkok$/i.test(iwayCity)) return "曼谷";
  return null;
}

function platformVehicleLabel(vehicleClass, modelCars) {
  const category = normalizedText(vehicleClass).split("(")[0].trim();
  // i'way 的 New ride 邮件中，Vehicle Class 有时只是 C、E 之类的内部
  // 分类代码，不是可派车/可展示的车型。此时优先使用同一封邮件里的
  // Model cars；若没有可读车型，明确显示“待核对”，避免误导地显示 C。
  const isInternalCode = /^[A-Z]\d?$/i.test(category);
  if (!isInternalCode) return category;

  const model = normalizedText(modelCars).split(/,\s*\d+\.\s*/)[0]
    .replace(/^\d+\.\s*/, "")
    .replace(/\(\s*(?:\d+\s*)?(?:seats?|pax)\s*[-:]\s*\d+\s*\)/gi, "")
    .replace(/\(?\s*\d+\s*(?:seats?|pax)\s*[-:]\s*\d+\s*\)?/gi, "")
    .replace(/\s*(?:,|;|-)?\s*(?:seats?|pax)\b.*$/i, "")
    .replace(/[\s,;:-]+$/, "")
    .trim();
  return model || "待核对";
}

function parseOrder(message, meta) {
  const text = normalizedText(message.body_plain_text);
  const orderNo = capture(text, /Ride number:\s*([\d\s]+?)\s+City:/i).replace(/\s/g, "");
  const iwayCity = capture(text, /City:\s*(.*?)\s+Pick-up date:/i);
  const date = serviceDate(capture(text, /Pick-up date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i));
  const pickupTime = capture(text, /Local pick-up time:\s*(\d{1,2}:\d{2})/i);
  const vehicleBlock = capture(text, /Vehicle Class:\s*(.*?)\s+Model cars:/i);
  const modelCars = capture(text, /Model cars:\s*(.*?)\s+Pax:/i);
  const vehicleType = platformVehicleLabel(vehicleBlock, modelCars);
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
  const city = cityFromOrder(iwayCity, pickupAddress, dropoffAddress);
  const children = Number(capture(text, /Children:\s*(\d+)/i)) || 0;
  const statedAdults = Number(capture(text, /Adults:\s*(\d+)/i)) || 0;
  const adults = statedAdults || Math.max(0, pax - children);
  if (!orderNo || !city || !date || !pickupTime || !pickupAddress || !dropoffAddress || !passengers.length || !phones.length || !vehicleType) return null;
  return {
    orderNo,
    city,
    serviceDate: date,
    pickupDateTime: new Date(`${date}T${pickupTime.padStart(5, "0")}:00+07:00`),
    pickupAddress: pickupAddress.trim(),
    dropoffAddress: dropoffAddress.trim(),
    passengerName: passengers.at(-1),
    passengerPhone: phones.join(" / "),
    flightNumber,
    platformVehicleType: vehicleType,
    seatCount,
    adults,
    children,
    luggage: adults + children,
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
  if (requestedOnly && !dryRun) {
    const request = await db.importSyncRun.findFirst({ where: { connector: "feishu-mail", status: "REQUESTED" }, orderBy: { startedAt: "asc" } });
    if (!request) {
      console.log(JSON.stringify({ status: "idle", message: "没有待处理的网站同步请求。" }));
      return;
    }
    syncRequestId = request.id;
    await db.importSyncRun.update({ where: { id: request.id }, data: { status: "RUNNING" } });
  }
  // lark-cli 的 from 数组并非“任一发件人”。分别按单一官方发件人查询，
  // 再合并结果，既不会漏掉 New ride，也不必下载整个邮箱的 400 封目录。
  // 同步是增量的：已解析邮件已留有缓存，新订单/修改邮件总会排在最新位置。
  // 每个发件人只看最近 30 封，避免旧邮件越来越多后拖慢每一次人工刷新。
  const triages = [{ sender: officialSender, max: 30 }, { sender: newRideSender, max: 30 }].map(({ sender, max }) => runCli([
    "mail", "+triage", "--as", "user", "--mailbox", mailbox,
    "--filter", JSON.stringify({ from: [sender] }), "--max", String(max), "--format", "json",
  ]));
  const triageMessages = triages.flatMap((result) => result.messages || []);
  const scannedCount = triages.reduce((total, result) => total + Number(result.count || 0), 0);
  const candidates = triageMessages.filter((mail) =>
    /(?:Transfer service order|New ride\s*#|AMENDMENT to the transfer|cancel(?:lation|led|ed)?.*transfer|transfer.*cancel(?:lation|led|ed)?)/i.test(mail.subject) &&
    /i[’']way/i.test(mail.subject),
  );
  const uniqueCandidates = [...new Map(candidates.map((mail) => [mail.message_id, mail])).values()];
  // 历史邮件无需每次重新下载正文。新修改邮件会有新的 message_id，仍会被
  // 自动读取并覆盖对应订单；这让后续手动刷新从约一分钟降到只查邮件目录。
  const previouslyRead = dryRun ? [] : await db.importedSourceMessage.findMany({
    where: { connector: "feishu-mail", externalId: { in: uniqueCandidates.map((mail) => mail.message_id) } },
    select: { externalId: true },
  });
  const knownIds = new Set(previouslyRead.map((item) => item.externalId));
  const pendingCandidates = dryRun ? uniqueCandidates : uniqueCandidates.filter((mail) => !knownIds.has(mail.message_id));
  const details = pendingCandidates.length ? runCli([
    "mail", "+messages", "--as", "user", "--mailbox", mailbox,
    "--message-ids", pendingCandidates.map((mail) => mail.message_id).join(","),
    "--html=false", "--format", "json",
  ]) : { data: { messages: [] } };
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
      scanned: scannedCount,
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
  const summary = { scanned: scannedCount, candidateMessages: uniqueCandidates.length, parsedMessages: parsed.filter((event) => event.action === "upsert").length, cancellationMessages: parsed.filter((event) => event.action === "cancel").length, futureOrders: future.length, created: [], updated: [], cancelled: [], unchanged: [], rejected: rejectedMessages.length };
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
  // 只标记已成功读懂的邮件。格式异常的邮件仍会在下一次刷新重试，避免
  // 一次解析器故障把订单永久忽略。
  const processed = parseResults.filter((result) => result.event?.orderNo).map((result) => ({
    connector: "feishu-mail",
    externalId: result.message.message_id,
    action: result.event.action,
    sourceText: result.message.body_plain_text || "",
    receivedAt: result.event.receivedAt,
  }));
  if (processed.length) await db.importedSourceMessage.createMany({ data: processed, skipDuplicates: true });
  if (syncRequestId) {
    await db.importSyncRun.update({ where: { id: syncRequestId }, data: { status: "SUCCEEDED", completedAt: new Date(), createdCount: summary.created.length, updatedCount: summary.updated.length, cancelledCount: summary.cancelled.length, skippedCount: summary.unchanged.length + summary.rejected } });
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
  if (syncRequestId) {
    await db.importSyncRun.update({ where: { id: syncRequestId }, data: { status: "FAILED", completedAt: new Date(), errorMessage: error instanceof Error ? error.message : "未知同步错误" } });
  }
  throw error;
}).finally(async () => {
  clearTimeout(watchdog);
  await db.$disconnect();
});
