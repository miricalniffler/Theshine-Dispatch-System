# API 契约

所有接口返回 JSON。成功：`{ "data": ... }`；失败：`{ "error": { "code": "...", "message": "...", "fields": [] } }`。

| 业务 | 接口 |
|---|---|
| 订单 | `GET/POST /api/orders`、`GET/PATCH /api/orders/:id` |
| 订单导入 | `POST /api/orders/import/parse`、`duplicates`、`commit` |
| 车队 | `GET/POST /api/fleets`、`GET/PATCH /api/fleets/:id` |
| 派单 | `POST /api/dispatch-batches/preview`、`copy-log`、`confirm` |
| 司机资料 | `GET/POST/PATCH /api/orders/:id/driver-details` |
| 回传 | `POST /api/iway-return-batches/preview`、`copy-log`、`confirm` |
| 规则 | `GET /api/rules/current|history`、`POST /api/rules/preview|publish` |

所有 `confirm` 接口必须写入文本快照、规则版本、确认时间和操作记录；复制接口不得改变订单状态。
