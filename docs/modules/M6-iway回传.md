# M6：i’way 回传

**边界**：同服务日订单合并预览、复制和人工确认；不直接发送 WhatsApp。

**分组规则**：同一服务日、状态为待回传且司机资料完整的曼谷/苏梅订单可合并；不同服务日拒绝。

**数据/API**：`iway_return_batches`、`iway_return_batch_orders`；`POST /api/iway-return-batches/preview`、`copy-log`、`confirm`。

**渲染规则**：YAML 回传 header 一次、每单 body 一段、YAML footer 一次。

**验收**：缺任一司机字段明确列出且禁止生成；复制不变状态；二次确认后保存快照与日志，订单变为已完成。
