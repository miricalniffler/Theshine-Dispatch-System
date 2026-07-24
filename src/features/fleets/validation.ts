import { z } from "zod";

export const fleetInputSchema = z.object({
  name: z.string().trim().min(1, "请填写车队名称").max(80),
  city: z.enum(["曼谷", "苏梅"], { message: "请选择服务城市" }),
  chatNote: z.string().trim().min(1, "请填写群聊备注").max(120),
  vehicleTypes: z.array(z.string().trim().min(1)).min(1, "请至少选择一种车型").max(12),
  note: z.string().trim().max(500),
  enabled: z.boolean(),
});
