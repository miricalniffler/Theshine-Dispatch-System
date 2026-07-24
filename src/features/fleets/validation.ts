import { z } from "zod";

export const fleetInputSchema = z.object({
  name: z.string().trim().min(1, "请填写车队名称").max(80),
  city: z.enum(["曼谷", "苏梅"], { message: "请选择服务城市" }),
  // 联络、车型和备注均是可选的运营资料，允许暂时留空后再补充。
  chatNote: z.string().trim().max(120),
  vehicleTypes: z.array(z.string().trim().min(1)).max(12),
  note: z.string().trim().max(500),
  enabled: z.boolean(),
});
