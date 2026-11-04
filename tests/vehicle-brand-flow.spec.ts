import { test, expect } from "@playwright/test";
import { db } from "../src/lib/db";
import { identifyVehicleFromImage } from "../src/features/assist/service";
import { analyzeFleetReply, confirmFleetReply } from "../src/features/fleet-replies/service";
import { getDriverDetails, createIwayPreview } from "../src/features/iway/service";
import { listSqliteOrders, findPersistedOrder } from "../src/features/orders/sqlite-repository";

test.describe.configure({mode:"serial"});
// In-memory persistence adapter; AI transport only is stubbed. Production
// analysis/confirmation/save/archive/read/preview functions run unchanged.
function harness(ai: {vehicle_brand:string|null;vehicle_model:string|null;confidence:string}, historyVehicleModel: string | null = null) {
 const originals:Array<()=>void>=[];
 function stub(delegate:string,method:string,fn:any){const obj=(db as any)[delegate];const old=obj[method];obj[method]=fn;originals.push(()=>obj[method]=old);}
 const order:any={id:"test-order",platformOrderNumber:"9900001",city:"曼谷",serviceDate:"2026-11-02",pickupDateTime:new Date("2026-11-02T02:00:00Z"),passengerName:"Test Passenger",passengerPhone:"+10000000000",pickupAddress:"Test airport",dropoffAddress:"Test hotel",platformVehicleType:"Comfort",status:"DISPATCHED",createdAt:new Date(),fleet:{name:"Test fleet"},driverDetail:null,driverVehicleAssignments:[],customerCommunicationExceptions:[],activityLogs:[]};
 const reply:any={id:"test-reply",candidateOrderIds:JSON.stringify([order.id]),dispatchBatchId:null,rawText:`Order Number: 9900001\nDriver: Test Driver\nPhone: 0812345678\nPlate: กก 1234${ai.vehicle_model ? "\nModel: Test model" : ""}`,createdBy:"运营人员|BANGKOK",images:[]};
 let extraction:any=null;let driver:any=null;const logs:any[]=[];let writes=0;let assignmentWrites=0;let batches=0;
 const expanded=()=>({...order,driverDetail:driver,activityLogs:[]});
 stub("fleetReply","findUnique",async()=>reply);
 stub("order","findMany",async()=>[expanded()]);stub("order","findUnique",async()=>expanded());stub("order","update",async({data}:any)=>Object.assign(order,data));
 stub("aiExtraction","create",async({data}:any)=>extraction={id:"extraction-current",...data});stub("aiExtraction","findFirst",async()=>extraction);
 stub("driverDetail","findMany",async()=>historyVehicleModel ? [{licensePlate:"กก 1234",confirmedVehicleModel:historyVehicleModel}] : []);
 stub("driverDetail","upsert",async({create,update}:any)=>{writes++;driver={id:"test-driver-detail",driverProfileId:null,vehicleProfileId:null,...(driver?{...driver,...update}:create)};return driver;});
 stub("driverDetail","update",async({data}:any)=>Object.assign(driver,data));stub("driverDetail","findUnique",async()=>driver);stub("driverDetail","findUniqueOrThrow",async()=>driver);
 stub("driverPhone","findUnique",async()=>({driverProfileId:"profile-driver"}));stub("driverProfile","findUnique",async()=>({id:"profile-driver",displayName:"Test Driver"}));
 stub("vehicleProfile","findUnique",async()=>({id:"profile-vehicle",isVerified:true}));
 stub("orderDriverVehicleAssignment","findFirst",async()=>({driverProfileId:"profile-driver",vehicleProfileId:"profile-vehicle",driverNameForIway:"Test Driver",driverNameSource:"MANUAL"}));
 stub("orderDriverVehicleAssignment","updateMany",async()=>{assignmentWrites++;return{count:0};});stub("orderDriverVehicleAssignment","create",async()=>{assignmentWrites++;return{};});
 stub("activityLog","create",async({data}:any)=>{logs.push(data);return data;});stub("activityLog","createMany",async({data}:any)=>{logs.push(...data);return{count:data.length};});stub("activityLog","findMany",async()=>[]);
 stub("driverDetailConfirmation","createMany",async()=>({count:1}));stub("iwayReturnBatch","create",async()=>{batches++;return{};});
 const transaction=db.$transaction;(db as any).$transaction=async(fn:any)=>fn(db);originals.push(()=>(db as any).$transaction=transaction);
 const realFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({records:[{order_number:order.platformOrderNumber,driver_name:"Test Driver",driver_phone:"0812345678",license_plate:"กก 1234",vehicle_category:"SUV",...ai}]})}}]}),{status:200});originals.push(()=>globalThis.fetch=realFetch);
 for(const [key,value] of Object.entries({AI_VISION_REAL_CALLS_ENABLED:"true",GLM_API_KEY:"test-key",AI_NAME_TRANSLITERATION_ENABLED:"false"})){const old=process.env[key];process.env[key]=value;originals.push(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}
 return {order,reply,logs,get writes(){return writes;},get assignments(){return assignmentWrites;},get batches(){return batches;},get extraction(){return extraction;},restore(){originals.reverse().forEach(fn=>fn());}};
}
const input=(model:string,extra:any={})=>({orderId:"test-order",driverName:"Test Driver",driverPhone:"0812345678",licensePlate:"กก 1234",vehicleCategory:"SUV",vehicleModel:model,...extra});

test("AI 未收录品牌型号 → 确认写入 → 列表/详情/编辑读取 → iWay 预览完整保留",async()=>{
 const h=harness({vehicle_brand:"BYD",vehicle_model:"Sealion 7",confidence:"HIGH"});
 try{
  const a=await analyzeFleetReply(h.reply.id);expect(a.result.records[0].vehicle_model.value).toBe("BYD Sealion 7");expect(a.result.records[0].needs_review).toBe(false);
  const saved=await confirmFleetReply(h.reply.id,{extractionId:a.extractionId,records:[input("BYD Sealion 7")]});expect(saved.valid).toBe(true);
  expect((await listSqliteOrders({keyword:"9900001"}))[0].driverDetail?.confirmedVehicleModel).toBe("BYD Sealion 7");
  expect((await findPersistedOrder(h.order.id))?.driverDetail?.confirmedVehicleModel).toBe("BYD Sealion 7");
  expect((await getDriverDetails(h.order.id))?.confirmedVehicleModel).toBe("BYD Sealion 7");
  const preview=await createIwayPreview([h.order.id]);expect(preview.valid).toBe(true);expect(preview.text).toContain("BYD Sealion 7");
  expect(h.assignments).toBe(0);expect(h.batches).toBe(0);expect(h.logs.some(x=>x.action==="订单换车/换司机")).toBe(false);
 }finally{h.restore();}
});
test("历史同车牌仅有型号时，可靠 AI 品牌会补全并贯穿预览、保存与 i’way", async()=>{
 const h=harness({vehicle_brand:"Toyota",vehicle_model:null,confidence:"HIGH"}, "Hiace");
 try {
  const analysis=await analyzeFleetReply(h.reply.id);
  const record=analysis.result.records[0];
  expect(record.vehicle_category.value).toBe("SUV");
  expect(record.vehicle_brand.value).toBe("Toyota");
  expect(record.vehicle_model.value).toBe("Toyota HiAce");
  expect(record.vehicle_model.evidence).toContain("按相同车牌复用已确认的历史车型");
  expect(record.needs_review).toBe(false);
  // The editable field may still receive the short form. With the operator's
  // explicit confirmation it follows the same shared brand+model resolver.
  const saved=await confirmFleetReply(h.reply.id,{extractionId:analysis.extractionId,records:[input("Hiace",{vehicleManualConfirmed:true})]});
  expect(saved.valid).toBe(true);
  expect((await getDriverDetails(h.order.id))?.confirmedVehicleModel).toBe("Toyota HiAce");
  expect((await createIwayPreview([h.order.id])).text).toContain("Toyota HiAce");
 } finally { h.restore(); }
});
for(const ai of [{vehicle_brand:null,vehicle_model:"INOVA",confidence:"HIGH"},{vehicle_brand:"Honda",vehicle_model:"Toyota Camry",confidence:"HIGH"},{vehicle_brand:"Toyota",vehicle_model:"อินโนวา",confidence:"LOW"}]) test(`待复核阻断及显式人工确认 ${ai.vehicle_model}`,async()=>{
 const h=harness(ai);try{
  const a=await analyzeFleetReply(h.reply.id);expect(a.result.records[0].needs_review).toBe(true);
  for(const extractionId of [a.extractionId,undefined]){const result=await confirmFleetReply(h.reply.id,{extractionId,records:[input(a.result.records[0].vehicle_model.value!)]});expect(result.valid).toBe(false);expect(h.writes).toBe(0);}
  // A truthy string is not explicit boolean confirmation.
  expect((await confirmFleetReply(h.reply.id,{records:[input("Toyota Innova",{vehicleManualConfirmed:"true"})]})).valid).toBe(false);
  const approved=await confirmFleetReply(h.reply.id,{extractionId:a.extractionId,records:[input("Toyota Innova",{vehicleManualConfirmed:true})]});expect(approved.valid).toBe(true);
  expect((await createIwayPreview([h.order.id])).text).toContain("Toyota Innova");expect(h.order.platformVehicleType).toBe("Comfort");
 }finally{h.restore();}
});
test("不能用错误分析编号或更换到无对应分析的订单绕过；改车型后须再次确认",async()=>{
 const h=harness({vehicle_brand:"BYD",vehicle_model:"Sealion 7",confidence:"HIGH"});try{
  const a=await analyzeFleetReply(h.reply.id);
  expect((await confirmFleetReply(h.reply.id,{extractionId:"another-reply-extraction",records:[input("INOVA")]})).valid).toBe(false);
  expect((await confirmFleetReply(h.reply.id,{records:[input("INOVA")]})).valid).toBe(false);
  const raw=JSON.parse(h.extraction.validatedResultJson);raw.records[0].order_match.platform_order_number="9900002";h.extraction.validatedResultJson=JSON.stringify(raw);
  expect((await confirmFleetReply(h.reply.id,{extractionId:a.extractionId,records:[input("INOVA")]})).valid).toBe(false);expect(h.writes).toBe(0);
 }finally{h.restore();}
});
test("AI 关闭时，规则解析到单独型号仍须人工核对",async()=>{
 const h=harness({vehicle_brand:null,vehicle_model:"INOVA",confidence:"HIGH"});try{process.env.AI_VISION_REAL_CALLS_ENABLED="false";const a=await analyzeFleetReply(h.reply.id);expect(a.result.records[0].needs_review).toBe(true);expect((await confirmFleetReply(h.reply.id,{records:[input("INOVA")]})).valid).toBe(false);expect(h.writes).toBe(0);}finally{h.restore();}
});

for (const confidence of ["HIGH", "LOW"]) test(`图片入口保留完整新车型并执行置信度复核 ${confidence}`, async()=>{
 const h=harness({vehicle_brand:"BYD",vehicle_model:"Sealion 7",confidence});
 try{globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({vehicle_brand:"BYD",vehicle_model:"Sealion 7",confidence})}}]}),{status:200});
 const result=await identifyVehicleFromImage("https://example.invalid/test.png");expect(result.value).toBe("BYD Sealion 7");expect(result.status).toBe(confidence==="HIGH"?"SUGGESTION_READY":"MANUAL_REVIEW_REQUIRED");expect(h.writes).toBe(0);
 }finally{h.restore();}
});
