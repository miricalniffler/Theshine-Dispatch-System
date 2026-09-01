# WhatsApp 接入技术探路（WP0）

**日期：** 2026-09-02  
**范围：** 仅做 Phase 2 的可行性验证；未修改 Prisma、数据库、现有订单流程或发送功能。

## 技术结论

建议直接接入 **Meta 官方 WhatsApp Business Platform Cloud API**，不经过 Twilio 等中间服务商。现有项目的 Next.js API Route 很适合承载发送接口与 webhook；Vercel 适合运行定时扫描；PostgreSQL/Prisma 适合保存“已发送什么、发给谁、平台回执、重试次数”的可靠记录；Supabase Storage 适合保存机场指引图片。

这条路线可满足产品 V1 的文字、图片、客户回复、T-24h 兜底和司机资料二次通知，但有一个不能绕开的产品约束：**业务主动发给客户的第一条消息，通常处于 24 小时客服会话窗口之外，必须使用 Meta 预审通过的消息模板。** 因此，模板审核和真实号码上线是 WP1 开始前的 Go / No-Go 条件。

## 与现有项目的接入点

| 现有基础 | 已确认用途 | WP1 以后最小增量 |
| --- | --- | --- |
| `Order` | 已有 `passengerPhone`、`pickupDateTime`、接送地址、航班、人数、行李、城市 | 只读取这些字段生成客户消息；不改导入格式 |
| `DriverDetail` + `IwayReturnBatch` | 已有司机姓名、电话、车型、车牌，以及正式 i'way 回传确认时间 | 在 `confirmIwayReturn(batchId)` 成功后，创建“待发送司机资料通知”；外部 HTTP 请求不放进数据库事务 |
| `ActivityLog` | 已有审计记录习惯 | 继续记录高层业务动作；发送细节另存通知记录，避免一张日志承担全部职责 |
| Next.js App Router API | 现有 `/api/*` Route Handlers 可运行服务器端密钥逻辑 | 后续新增专用 sender、webhook、cron Route；浏览器绝不接触 Meta token |
| Vercel | 当前生产运行区为 `hnd1`，已有 `CRON_SECRET` 保护的 cron 模式 | 新增 T-24h 扫描 cron；仅生产部署执行 |
| Prisma/PostgreSQL | 已运行在托管 PostgreSQL | 后续新增通知/outbox/inbound 表，做唯一约束防重；本 WP0 未迁移 |
| Supabase 依赖 | 已有浏览器客户端依赖，但现有车队图片仍以 data URL 入库 | 机场指引图片应改用 Supabase Storage/公开或签名 URL；不要把图片二进制塞入 PostgreSQL |

## 推荐的最小可行架构

```text
订单 / 正式 i'way 回传
        ↓
CustomerNotification（数据库中的待发送记录 + 唯一防重键）
        ↓
Next.js 服务器端 WhatsApp Sender → Meta Cloud API
        ↓                                ↓
保存 wamid / 接收回执 webhook ← Meta 状态与客户回复
        ↓
CustomerInboundMessage + 人工异常（无法唯一关联时不猜）
```

1. **一个直连发送适配层：** 后续只在服务器端封装 `WhatsAppCloudTransport`，使用 Graph API 的 `/{phone-number-id}/messages`。业务页面和 cron 都调用同一层，不直接写 HTTP 调用。
2. **一个可靠的 outbox（待发送记录）：** 先在数据库写入待发送记录和唯一业务键，再异步发送；成功响应只代表 Meta 已受理，最终以 webhook 回执更新为已送达/已读/失败。这样网络超时或 cron 重跑不会重复骚扰客人。
3. **两类预审 Utility 模板：**
   - `first_contact_v1`：订单确认 + 行李询问；
   - `driver_info_v1` / `driver_info_update_v1`：正式 i'way 回传后的司机车辆信息。
   订单变量（时间、地点、航班、司机等）作为模板参数传入，不能让运营文字临时拼接后在窗口外直接发送。
4. **机场图片的 MVP：** 首次上线先把“文字指引 + 1 张主图”做成带图片 header 的 Utility 模板；机场库可保存多图，但窗口外不要直接连续发送普通图片。多图完整发送应在 Meta 控制台用真实样本验证后，再采用“多张各自带图片 header 的已审核 Utility 模板”或经审核的单一资料链接方案。不能假设普通媒体消息在窗口外可发。
5. **入站关联：** 优先用客户回复中的 `context.id`（被回复的 Meta 消息 `wamid`）直接找到 `CustomerNotification → Order`。没有 context 时，只能在该 WhatsApp 账号对应的“开放且唯一”的订单候选中关联；同一手机号同时有多笔候选订单时创建人工异常，绝不猜。

## Meta / WhatsApp 产品约束

### 主动发送与模板

- 使用官方 Cloud API 需要 WhatsApp Business Account（WABA）、关联的 Meta Business 账号和一个已登记的业务手机号；正式 API 访问还需要 Meta App 与相应访问令牌。
- 客户在过去 **24 小时 customer service window（客服会话窗口）** 内主动给企业发过消息后，企业可发普通 text/image 等非模板消息；窗口外只能发已批准的模板消息。
- 因而产品中的 **T-24h 第一轮** 必须按模板发送；正式 i'way 回传后的第二轮也应默认按模板发送，不能因为“客户可能刚回复过”而依赖 24 小时窗口。
- 订单确认、行李询问、既有订单的司机资料通知预期应按 **Utility（事务/服务）模板**申请；Meta 对实际分类拥有最终审核权，不能在代码里假定一定通过。
- WhatsApp 商业政策还要求业务发起消息前具有客户的有效 opt-in（同意接收 WhatsApp 消息）。订单表当前没有保存 opt-in 证据；正式上线前必须确定 i'way 下单流程是否已取得此同意，以及如何保存/追溯证据。

### 图片与媒体

- Cloud API 支持发送图片，通常可以先上传媒体得到 media id 后发送，或在允许的场景以 HTTPS URL 引用媒体。
- 模板可配置单个图片 header，适合 MVP 的“主图 + 指引文字”。多张机场图不能不经验证地当作多条普通图片在窗口外发送；需以提交审核后的模板实测为准。
- 不应把客户可见的机场图片继续保存为数据库 data URL。后续使用 Supabase Storage，并设置合适的访问 URL、文件类型/大小限制与清理策略。

### webhook、回执和客户回复

- Meta 需要一个公网 HTTPS webhook URL。验证时会以 GET 发送 `hub.mode`、`hub.verify_token`、`hub.challenge`；应用需要安全地回传 challenge。
- POST webhook 必须校验 `X-Hub-Signature-256`（以 Meta App Secret 计算的 HMAC），不能仅凭一个 URL 隐藏起来。
- 订阅 WhatsApp 的 `messages` 字段后，webhook 同时承载客户入站消息和出站状态。发送接口返回的 `wamid` 仅表示 Meta 接收请求；`sent`、`delivered`、`read`、`failed` 以 webhook 为准。
- webhook 应先持久化原始事件、按 Meta 消息 ID 去重，再快速返回 HTTP 200；复杂的 AI 理解放到后续任务，不要拖慢 webhook。

### 电话号码与身份

- 发送目的地使用国家码 + 手机号的国际格式，建议数据库/发送层统一为仅数字的 E.164 形式，例如泰国 `+66 81 788 5054` 变为 `66817885054`；不能把本地 `0` 与 `+66` 同时保留。
- 发送前应使用保守的国家码解析/校验；无效或无法正常化的客户号码不发消息，生成异常。
- 收到 webhook 后，以 Meta 返回的 WhatsApp 用户标识/号码为准，并将其与本次出站记录保存。电话号码不是唯一订单键：同一客户可能有多笔订单。

### 重试、防重与费用

- Meta/Vercel 可能出现“请求结果不确定、webhook 重投、cron 重复或重叠”情况。防重必须靠数据库唯一约束，而不是只靠前端按钮状态。
- 推荐唯一键：`orderId + notificationType + businessVersion/snapshotHash`。首次联系同一订单只允许一个成功快照；司机资料只在正式 i'way 回传后、与上次已发快照不同才创建新记录。
- 重试仅针对明确的临时错误，设有限次数和退避；一旦已有 `wamid` 或已收到回执，不新建第二次发送。最终失败进入人工异常。
- 自 2025-07 起 Meta 按**已送达的模板消息**计费；费率取决于模板类别、收件人国家码和量级。客服窗口内的非模板消息、以及窗口内的 Utility 模板按当前规则可能免费，但费率会更新。上线前在 WhatsApp Manager 的当前 Rate Card 和账单设置中确认目标国家实际价格与付款方式。

## T-24h 与现有 Vercel Cron 的判断

**结论：可以使用，但建议生产项目使用 Vercel Pro 或等价的可靠调度。**

- 当前 `vercel.json` 仅有飞书同步 cron，且为每天一次；它不能单独保证接近每笔订单的 T-24h 时点。
- 推荐新增每 15 分钟一次的生产 cron：筛选“区域开关开启、尚未成功首联、`pickupDateTime <= now + 24h`、尚未被 outbox 占用”的订单。它应是“到点后尽快发”，不是要求在准确某一分钟发。
- Vercel Cron 按 UTC 表达；订单比较必须以 `pickupDateTime` 的绝对时间完成，页面显示再使用 Bangkok 时区。预览部署不会运行 Vercel Cron。
- Vercel Hobby 目前只允许 cron 每天一次，且可有接近一小时的调度误差，不适合可靠的 T-24h 兜底。Pro 支持更频繁调度，但 Vercel 不会自动重试失败任务，也可能重复或并发调用，所以仍需数据库锁/claim 和幂等键。

## 账号所有者需要准备（请勿把密钥发到聊天中）

1. **Meta Business Portfolio / Business Manager**：拥有企业管理权限；完成 Meta 要求的企业验证（如适用）。
2. **WhatsApp Business Account（WABA）**：在 Business Manager 中创建或确认归属，并准备付款方式/账单主体。
3. **一个专用业务手机号**：能接收 SMS/语音验证码、未被不兼容的 WhatsApp 个人/Business App 占用，或先确认官方 coexistence（共存）方案是否符合需求。建议不要用员工私人号码。
4. **Meta Developer App**：由账号所有者创建并添加 WhatsApp 产品；配置生产模式。
5. **权限与长期凭据**：为受控的 System User 授予最小权限（通常包括 `whatsapp_business_messaging` 与 `whatsapp_business_management`），生成长期/系统用户 access token；同时记录 `WABA ID`、`Phone Number ID`、Meta App ID 和 App Secret。令牌只存 Vercel 加密环境变量，绝不提交 GitHub 或粘贴进聊天。
6. **Webhook 信息**：确定生产域名，准备一个随机 `WHATSAPP_WEBHOOK_VERIFY_TOKEN`，在 Meta 配置 callback URL；App Secret 用于签名校验。
7. **模板与审核材料**：提交英文（必要时多语言）Utility 模板，至少包含第一轮、司机资料、司机资料更新，以及机场指引图文模板；用真实订单变量和真实图片样本完成审核测试。
8. **客户同意（opt-in）证据**：确认 i'way 的订单/隐私流程是否允许本地承运方用 WhatsApp 就该行程联系客人；如未覆盖，需要业务/法务确定收集文案、保存位置与撤回处理方式。
9. **费用确认**：在 WhatsApp Manager 确认目标国家费率、付款方式、预算提醒及消息质量监控责任人。

## 已确认事项

- 项目架构可直接支持官方 Cloud API，不需要换框架或引入第三方 BSP。
- 订单已有生成第一轮和第二轮消息所需的核心字段：客户电话、接送时间、接送地址、航班、人数、司机与车辆资料。
- `confirmIwayReturn(batchId)` 是第二轮通知的正确业务挂接点；现有事务完成后创建 outbox 即可，不应改变 i'way 回传逻辑。
- Vercel 已有 cron 与 `CRON_SECRET` 的安全模式，能复用，但目前的每天一次配置不足以实现可靠 T-24h。
- 当前 Supabase 仅有客户端初始化；机场指引存储需要在 WP1 确认 bucket、访问策略和服务器端上传方式。

## 尚未确认事项

- 企业是否已经有可用 WABA、已验证的 Meta Business、可用于 API 的业务手机号和付款方式。
- i'way 的乘客数据授权是否已包含“本地承运方通过 WhatsApp 主动联系”的有效 opt-in。
- Utility 模板具体文本、语言和机场多图方案能否在 Meta 审核中按预期通过。
- 目标客源国家的实际模板费率、税费和预算上限。
- 当前 Vercel 计划是否为 Pro；若不是，是否愿意升级，或使用外部可靠调度服务。
- Supabase 项目是否已配置可用于生产的 Storage bucket、文件保留策略和访问规则。

## 正式开发前 Go / No-Go

**Go（可以进入 WP1）**，前提是：

- 已取得有效 opt-in 的业务确认；
- WABA、生产业务号码、Meta App、付款方式可用；
- 至少一套第一轮和一套司机资料 Utility 模板已获批，且可用真实测试号码成功发送并收到 webhook；
- 已确定 Vercel Pro（或等价每 15 分钟可靠调度）及生产 webhook 域名；
- 令牌、App Secret、Webhook 验证 token 已按环境变量方案安全保管。

**No-Go（先不开始 WP1）**，如果其中任一项未满足：没有客户主动联系授权、没有可用正式业务号码/模板审核、或只能使用每天一次的 Hobby cron 却仍要求可靠 T-24h 自动发送。此时可以先准备账号与模板，但不要先做数据库和 UI 大开发。

## 参考资料（2026-09-02 核对）

- [Meta Terms for WhatsApp Business](https://www.whatsapp.com/legal/meta-terms-whatsapp-business) — WABA、Meta Business 关联与费用责任。
- [Meta 官方 WhatsApp Business Platform Postman Collection：Templates](https://www.postman.com/meta/whatsapp-business-platform/folder/lczy75a/templates) — Cloud API 模板管理与图片 header 模板示例。
- [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — Hobby/Pro 调度频率与精度。
- [Vercel Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — `CRON_SECRET`、不自动重试、重叠执行与幂等要求。
- [Vercel Cron quickstart](https://vercel.com/docs/cron-jobs/quickstart) — cron 仅在 production deployment 运行。

> Meta 开发者文档在本次资料读取时触发了其访问频率限制；上面关于模板窗口、回执、webhook 和价格的结论应在账号创建时再以 Meta 控制台当前提示复核，尤其是模板分类、图片模板和目标国家费率。
