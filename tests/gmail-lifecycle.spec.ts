import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { classifyLifecycleNotice, currentLifecycleText } from "../src/features/import/iway-lifecycle-parser";
import { ingestLifecycle, previewLifecycleReview, type MailReview } from "../src/features/import/gmail-lifecycle";
import { db } from "../src/lib/db";

test.describe.configure({ mode: "serial" });
const cancel = { id:"cancel-1", sender:"i'way <booking@iwayex.com>", subject:"CANCELLATION of the transfer #1 150 642 (i’way)", receivedAt:"2026-11-01T00:23:00Z", text:`Cancellation of transfer service order\nCustomer: TEST\nCANCELLATION\nDear partners, please cancel the following transfer.\nATTENTION: all the other orders stay valid.\nRide number:\n1150642\nCity:\nBangkok` };
const amend = { ...cancel, id:"amend-1", subject:"AMENDMENT to the transfer #1 150 642 (i’way)", text:"Dear partners, we send you an amendment of the following transfer\nRide number:\n1150642\nCity:\nBangkok" };
test("实际取消主题、正文与精确订单号必须同时一致",()=>{
  expect(classifyLifecycleNotice(cancel.subject,cancel.text.replace("\nRide number:\n1150642", "Ride number:\r\n \r\n1150642"))).toMatchObject({kind:"cancel",orderNumber:"1150642"});
  expect(classifyLifecycleNotice(cancel.subject,cancel.text.replace("Ride number:\n1150642", "Ride number:\r\n \r\n1150642"))).toMatchObject({kind:"cancel",orderNumber:"1150642"});
  expect(classifyLifecycleNotice(cancel.subject,cancel.text)).toMatchObject({kind:"cancel",orderNumber:"1150642"});
  expect(classifyLifecycleNotice(cancel.subject,cancel.text.replace("1150642","1150643"))).toMatchObject({kind:"review",orderNumber:null});
  expect(classifyLifecycleNotice(cancel.subject,cancel.text+"\nRide number: 972145")).toMatchObject({kind:"review"});
  expect(classifyLifecycleNotice(cancel.subject,cancel.text.replace("please cancel","please check"))).toMatchObject({kind:"review"});
  expect(classifyLifecycleNotice("Re: "+cancel.subject,cancel.text)).toBeNull();
  expect(classifyLifecycleNotice("Upcoming transfers [November 1, 2026]",cancel.text)).toBeNull();
  expect(classifyLifecycleNotice("Price request 000476032", "Cancellation policy: 24h")).toBeNull();
  expect(classifyLifecycleNotice(amend.subject,amend.text)).toMatchObject({kind:"amend"});
});
test("Apps Script 提取当前表格值并分开保留删除线旧值",()=>{
  const source=readFileSync("apps-script/gmail-iway-sync/Code.gs","utf8");
  const context=vm.createContext({}); vm.runInContext(source,context);
  const fields=vm.runInContext(`extractLifecycleFields_('<table><tr><td>Ride number:</td><td>1150642</td></tr><tr><td>Greeting sign:</td><td>New Name (<s style="color:gray">Old Name</s>)</td></tr><tr><td>Transfer:</td><td>Airport &rArr; Hotel &amp; Spa</td></tr></table>')`,context);
  expect(fields[1]).toMatchObject({label:"Greeting sign",current:"New Name ()",previous:["Old Name"]});
  expect(currentLifecycleText("old unstructured", fields)).not.toContain("Old Name");
  expect(source).toContain("booking@iwayex.com");
});
const linkedAmendment = {
  ...amend, id: "linked-amendment", subject: "AMENDMENT to the transfer #1 172 005 (i’way)",
  text: "Dear partners, we send you an amendment of the following transfer\nRide number: 1172005 <https://esforty.com/trips?number=1172005>\nCity: Bangkok",
  fields: [
    { label: "Ride number", current: "1172005", previous: [] },
    { label: "Vehicle class", current: "MINIVAN ()", previous: ["MINIBUS"] },
    { label: "Pax", current: "4 ()", previous: ["6"] },
    { label: "Passengers", current: "Test A,Test B,Test C,Test D", previous: ["Test A,Test B,Test C,Test D,Test E,Test F"] },
  ],
};
test("1172005：链接订单号与结构化表格用于一致性校验，冲突仍禁止自动操作", () => {
  expect(classifyLifecycleNotice(linkedAmendment.subject, linkedAmendment.text, linkedAmendment.fields)).toMatchObject({ kind: "amend", orderNumber: "1172005" });
  expect(classifyLifecycleNotice(linkedAmendment.subject, "Dear partners, we send you an amendment of the following transfer", linkedAmendment.fields)).toMatchObject({ kind: "amend", orderNumber: "1172005" });
  expect(classifyLifecycleNotice(linkedAmendment.subject, linkedAmendment.text.replace(/1172005/g, "1172006"), linkedAmendment.fields)).toMatchObject({ kind: "review", orderNumber: null });
  expect(classifyLifecycleNotice(linkedAmendment.subject, linkedAmendment.text, [...linkedAmendment.fields, { label: "Ride number", current: "1172006", previous: [] }])).toMatchObject({ kind: "review", orderNumber: null });
  expect(classifyLifecycleNotice("Transfer service order", linkedAmendment.text, linkedAmendment.fields)).toBeNull();
});
test("待办只读展示可修复旧识别并保留邮件三项变更；取消缺原单不变成新订单", () => {
  const stored: MailReview = { reason: "ORDER_NUMBER_MISSING_OR_CONFLICTING", orderNumber: null, kind: "review", differences: [], fields: [] };
  const projected = previewLifecycleReview(linkedAmendment, stored, null);
  expect(projected).toMatchObject({ mailType: "amend", kind: "amend", orderNumber: "1172005", reason: "AMEND_ORIGINAL_NOT_FOUND" });
  expect(projected.fields.filter(f => f.previous.length)).toHaveLength(3);
  expect(stored.orderNumber).toBeNull();
  const missingCancel = { ...cancel, subject: "CANCELLATION of the transfer #1 162 424 (i’way)", text: cancel.text.replace("1150642", "1162424") };
  expect(previewLifecycleReview(missingCancel, { ...stored, reason: "ORDER_NOT_FOUND" }, null)).toMatchObject({ mailType: "cancel", orderNumber: "1162424", reason: "CANCEL_ORIGINAL_NOT_FOUND" });
  expect(previewLifecycleReview(missingCancel, { ...stored, reason: "CANCELLED_NOTIFY_FLEET" }, null).reason).toBe("CANCELLED_NOTIFY_FLEET");
});
test("修改待办保留表格中的全部当前乘客与联系电话，不推断删除未变更的嵌套备注", () => {
  const message = { ...linkedAmendment, fields: linkedAmendment.fields.map(f => f.label === "Passengers" ? { ...f, current: "Test A,Test B,Test C,Test D () Phone: +7 111 111 1111,+7 222 222 2222,+7 333 333 3333,+7 444 444 4444" } : f).concat({ label: "Additional remarks", current: "PARAMS Toll road", previous: [] }) };
  const stored: MailReview = { reason: "ORDER_NOT_FOUND", orderNumber: null, kind: "review", differences: [], fields: [] };
  const review = previewLifecycleReview(message, stored, { passengerName: "Old names", passengerPhone: "Old contacts", platformVehicleType: "MINIBUS", adults: 6 } as any);
  expect(review.differences.find(d => d.field === "passengerName")?.proposed).toBe("Test A,Test B,Test C,Test D");
  expect(review.differences.find(d => d.field === "passengerPhone")?.proposed).toContain("+7 444 444 4444");
  expect(review.differences.some(d => d.field === "otherNotes")).toBeFalsy();
});
function fake(status="DISPATCHED", latest=false) {
  let known=false; const logs:any[]=[]; const sources:any[]=[]; const updates:any[]=[];
  const order:any={id:"order-1", platformOrderNumber:"1150642",status,driverDetail:status==="DISPATCHED"?{}:null,pickupDateTime:new Date("2026-11-01T04:00:00Z")};
  const tx:any={$executeRaw:async()=>0,$queryRaw:async()=>[],order:{findUnique:async()=>order,findUniqueOrThrow:async()=>order,update:async(v:any)=>{updates.push(v);order.status=v.data.status;}},importedSourceMessage:{findUnique:async()=>known?{}:null,findFirst:async()=>latest?{id:"newer"}:null,create:async(v:any)=>{known=true;sources.push(v);return v;}},activityLog:{create:async(v:any)=>{logs.push(v);}},iwayReturnBatchOrder:{findMany:async()=>[{iwayReturnBatchId:"batch-1"}]},iwayReturnBatch:{updateMany:async(v:any)=>updates.push(v)}};
  return {tx,logs,sources,updates,order};
}
test("取消原子写入、派车通知、永久失效旧回传、重试不重复",async()=>{
  const f=fake();const original=db.$transaction;
  (db as any).$transaction=async(fn:any)=>fn(f.tx);
  try {expect(await ingestLifecycle(cancel)).toBe("cancelledReview");expect(f.order.status).toBe("CANCELLED");expect(f.updates[1].data.contentSnapshot).toContain("已失效");expect(f.sources[0].data.action).toBe("LIFECYCLE_REVIEW_PENDING");expect(JSON.parse(f.sources[0].data.sourceText).review.reason).toBe("CANCELLED_NOTIFY_FLEET");const n=f.logs.length;expect(await ingestLifecycle(cancel)).toBe("skipped");expect(f.logs.length).toBe(n);}finally{(db as any).$transaction=original;}
});
for(const [status,latest] of [["COMPLETED",false],["DISPATCHED",true]] as const) test(`取消保护 ${status} newer=${latest}`,async()=>{
 const f=fake(status,latest);const original=db.$transaction;(db as any).$transaction=async(fn:any)=>fn(f.tx);
 try{expect(await ingestLifecycle(cancel)).toBe("review");expect(f.updates).toHaveLength(0);}finally{(db as any).$transaction=original;}
});
test("修改只创建差异待办，绝不覆盖或重新开启已取消订单",async()=>{
 const f=fake("CANCELLED");const original=db.$transaction;(db as any).$transaction=async(fn:any)=>fn(f.tx);
 try{expect(await ingestLifecycle(amend)).toBe("review");expect(f.updates).toHaveLength(0);expect(f.order.status).toBe("CANCELLED");}finally{(db as any).$transaction=original;}
});
test("待办重识别复用原邮件审计记录，不删除去重键", async()=>{
 const f=fake("READY_TO_DISPATCH");const original=db.$transaction;
 f.tx.importedSourceMessage.findUnique=async()=>({id:"audit-1",action:"LIFECYCLE_REVIEW_PENDING",sourceText:JSON.stringify({review:{reason:"ORDER_NUMBER_MISSING_OR_CONFLICTING"},message:cancel})});
 let saved:any=null;f.tx.importedSourceMessage.update=async(v:any)=>{saved=v;};(db as any).$transaction=async(fn:any)=>fn(f.tx);
 try{expect(await ingestLifecycle(cancel,true)).toBe("cancelled");expect(saved.where.id).toBe("audit-1");expect(saved.data.externalId).toBe(cancel.id);expect(f.sources).toHaveLength(0);expect(f.order.status).toBe("CANCELLED");}finally{(db as any).$transaction=original;}
});
test("重新识别不能替代已通知车队的人工确认",async()=>{
 const f=fake("CANCELLED");const original=db.$transaction;
 f.tx.importedSourceMessage.findUnique=async()=>({id:"audit-1",action:"LIFECYCLE_REVIEW_PENDING",sourceText:JSON.stringify({review:{reason:"CANCELLED_NOTIFY_FLEET"}})});(db as any).$transaction=async(fn:any)=>fn(f.tx);
 try{expect(await ingestLifecycle(cancel,true)).toBe("review");expect(f.updates).toHaveLength(0);expect(f.sources).toHaveLength(0);}finally{(db as any).$transaction=original;}
});
