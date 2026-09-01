# Phase 2 开发拆解 / Implementation Plan

对应产品 Spec：`AIRPORT_GUIDE_AND_CUSTOMER_NOTIFICATION_V1.md`

> 说明：本文尽量使用“英文术语 + 中文解释”的方式。比如 `implementation planning notes` = **实施规划备注**，`data model` = **数据模型/数据库结构设计**，`migration` = **数据库迁移**，`webhook` = **外部平台主动回调我们系统的接口**，`cron` = **定时任务**，`idempotency` = **幂等/防止同一动作被重复执行**。

## 总体策略

Phase 2 跨数据库、后台任务、WhatsApp 外部接口、订单主页、订单详情、i’way 回传和 AI 回复理解，属于跨模块开发。不要一次性让一个 Agent 从头做到尾，也不要多人同时改同一核心文件。

采用“先打地基，再接外部发送，再接自动化，再接回复理解”的顺序。

建议共分 6 个 Work Package（工作包）。其中 WP0 是技术探路，不写大规模业务功能；WP1-WP5 才是正式开发。

---

## WP0 — WhatsApp Integration Spike / WhatsApp 接入技术探路

### 目标

在写正式业务代码前，确认实际可用的 WhatsApp Business/API 方案和约束。

### Codex 要完成

1. 调研当前项目最适合的 WhatsApp 接入方式。
2. 明确：
   - 如何主动发送文字；
   - 如何发送多张机场指引图片；
   - 如何接收客人回复；
   - 如何确认发送成功/失败；
   - 是否需要预审模板；
   - T-24h 主动消息是否受 24 小时会话窗口限制；
   - webhook（回调接口）如何验证；
   - 媒体文件发送方式；
   - 费用与账号/API Key/Meta Business 配置要求。
3. 只输出技术决策文档，不要在这一阶段大规模改业务代码。
4. 如果需要用户开 Meta/WhatsApp Business 账号、申请权限、付费、创建 API Key，停下来向用户说明。

### 产物

`docs/technical/WHATSAPP_INTEGRATION_DECISION.md`

### 为什么先做

WhatsApp 是 Phase 2 唯一真正受外部平台规则强约束的部分。先确认它，避免数据库和页面写完后发现发送机制不成立。

---

## WP1 — Foundation Data Model / 基础数据库结构 + 机场指引库

### 目标

先建立 Phase 2 所需的“地基”，但暂时不自动给客人发 WhatsApp。

### 数据库建议

在现有 Prisma/PostgreSQL 基础上新增概念模型，名称可由 Codex 按现有命名习惯调整：

- `AirportGuide`：机场指引
- `AirportGuideImage`：机场指引图片
- `RegionNotificationSetting`：各运营区域 WhatsApp 开关
- `CustomerNotification`：给客人发送过的通知记录/发送快照
- `CustomerInboundMessage`：客人发回来的原始消息
- `CustomerCommunicationException`：需要人工处理的客人沟通异常（如架构上更适合复用 ActivityLog/现有异常机制，可以复用，不强制新表）
- Order 增加结构化行李字段时，要尽量轻量；现有 `luggage Int` 不要直接破坏兼容性。

### 机场指引功能

新增“机场指引库”页面，并加入主导航。

V1 字段：

- 机场名称
- IATA 代码（可选但建议）
- 识别别名/关键词
- 航站楼（可选）
- 指引文字
- 多张图片直接上传
- 启用/停用

不做地图链接，不做送机指引。

### 机场识别模块

独立成可测试的纯规则函数：

1. IATA 代码
2. 别名/关键词
3. 保守地址/模糊规则
4. 仍识别不了：不调用 AI

输出至少区分：

- `AIRPORT_PICKUP_MATCHED`
- `AIRPORT_DROPOFF`
- `NON_AIRPORT`
- `AIRPORT_LIKE_UNRESOLVED`
- `AIRPORT_MATCHED_GUIDE_MISSING`

具体枚举名称可以调整，但业务语义必须保留。

### 区域开关

在“设置 / 规则”附近增加简单配置 UI：

- 曼谷：WhatsApp 通知 ON
- 苏梅：WhatsApp 通知 OFF

注意：不能把城市写死进逻辑；这些只是初始配置。

### 图片存储

项目已经依赖 Supabase。Codex 应先检查当前图片上传/存储方式，优先复用既有基础设施或 Supabase Storage，不要把图片二进制存进 PostgreSQL。

### 验收

- 可创建/编辑/停用机场指引。
- 可上传多图。
- 可配置区域 WhatsApp 开关。
- 给定几组订单地址，规则能稳定判断接机/送机/普通地址/机场样地址无法识别。
- 机场识别零 AI 调用。
- 有 Prisma migration（数据库迁移）时必须明确列出新增表/字段，并保证不破坏现有订单。

---

## WP2 — First Contact / 第一轮联系：手动批量 + T-24h 自动兜底

### 目标

实现第一轮客人联系的“生成、预览、发送、留记录”。

### 主页

在现有 `/orders` 批量操作区增加：

**批量联系客人**

与现有：

- 批量生成车队派单
- 批量回传 i’way

并列。

### 批量预览

选中订单后：

- 正常订单默认勾选；
- 无有效电话等真正无法发送的订单默认排除；
- 接机但缺机场指引：仍允许发送核心消息，只显示警告；
- 每笔可展开预览；
- 单次临时修改只影响本次发送，不修改全局模板。

### 第一轮消息

固定模板，不用 AI 自由写：

- 自报家门；
- 日期/时间/路线/人数/航班等订单信息；
- 请客人确认；
- 询问行李数量，特别是大件行李；
- 接机时追加机场指引文字和图片；
- 送机/非机场接机不发指引。

### T-24h 自动发送

新增 cron（定时任务）。项目已经有 Vercel Cron 和 `CRON_SECRET` 模式，优先复用现有安全方式。

规则：

- 只处理区域开关为 ON 的订单；
- 第一轮尚未成功发送；
- pickupDateTime 距当前 <= 24h；
- 如果订单导入时已经处于 T-24h 内，也进入尽快发送范围；
- 不设置联系时段；
- 不设置“紧急/非常紧急”。

### 防重发

这是高优先级：

必须用 `CustomerNotification` + 唯一业务键/幂等键（idempotency key）保证 cron 重跑、网络超时、服务重试时不会给客人重复发送同一轮消息。

### 失败

- 可自动有限重试；
- 达到上限后停止；
- 生成需要人工处理的异常；
- 不阻塞订单其他业务。

### 验收

- 手动批量发送可以工作。
- T-24h 自动任务可以独立工作，不需要用户打开网页。
- 手动先发后，T-24h 不重复发送。
- 缺机场指引不阻塞核心消息。
- 区域 OFF 的订单完全不参与。
- 重复调用 cron 不造成重复 WhatsApp。

---

## WP3 — Inbound Reply Understanding / 客人回复理解 + 行李异常

### 目标

让系统“读懂”客人回复，但 V1 不做自由 AI 客服。

### 入站消息

WhatsApp webhook 收到消息后：

1. 保存原始消息；
2. 根据手机号/会话信息匹配订单；
3. 如果无法唯一匹配订单，进入人工异常，不要猜。

### 解析顺序

便宜、确定的规则优先：

- Yes / Correct / OK 等简单确认，不调用 AI；
- 明确数字 + luggage/suitcase/bag 等简单表达，先规则解析；
- 规则无法可靠理解时，才调用现有 Qwen 能力。

AI 输出必须结构化 JSON，不允许直接自由回复客人。

### AI 可判断

- 是否确认订单；
- 大件行李数量；
- 小件/随身行李数量；
- 婴儿车/特殊大件；
- 是否在说订单有误；
- 可能有误的是航班/时间/日期/人数/地址等；
- 是否无法安全理解。

### AI 不可以做

- 自动修改 i’way 原始订单；
- 自动给客人自由回复；
- 猜机场。

### 行李写回

保留原始回复，同时写结构化行李信息。

现有 `Order.luggage` 可以继续作为总数/兼容字段，但新增字段应区分至少“大件”与其他信息，避免为了 V1 破坏现有导入逻辑。

### 行李异常

两层：

1. 人数 vs 行李本身异常，例如 6 人 13 个大箱；
2. 已安排车型 vs 行李承载能力异常。

车型承载规则由业务配置，不让 AI 猜。

异常只提醒，不拦截派单。

### 订单异议

客人说航班/时间/地址等有误：

- 保存原话；
- AI/规则标记可能差异；
- 通知运营；
- 不自动修改订单。

### 验收

- 简单回复不浪费 AI token。
- 复杂行李回复可经 AI 结构化。
- 原始消息始终保留。
- 订单异议绝不直接改原订单。
- 无法理解时只提醒人工，不乱回消息。

---

## WP4 — Driver Notification Hook / i’way 回传后自动发送司机信息

### 目标

把第二轮客人联系挂到现有真实业务动作上。

### 现有接入点

当前正式确认 i’way 回传最终进入 `confirmIwayReturn(batchId)`。这个函数已经在事务里记录 `confirmedAt`、更新订单并写 ActivityLog。

Phase 2 应围绕这个现有服务接入，不另造“确认司机”按钮。

### 行为

成功正式回传 i’way 后：

- 区域通知 OFF → 不做客人通知；
- 必要司机资料完整 → 立即发送司机/车辆信息；
- 资料不完整 → 不发残缺消息，产生异常；
- 保存实际发送内容的 CustomerNotification 快照。

### 更换司机

后续司机/车辆数据库字段发生变化本身不发送。

只有再次正式回传 i’way 时：

- 与上一次成功发送的司机通知快照比较；
- 有变化 → 发“司机信息更新”；
- 完全相同 → 不重复发送。

### 事务边界

不要把外部 WhatsApp HTTP 请求硬塞进数据库 transaction（数据库事务）里长时间等待。

建议：

1. 数据库先可靠记录 i’way 回传成功事实；
2. 创建待发送 notification/job；
3. 再执行外部发送；
4. 根据结果更新 notification。

这样 WhatsApp 暂时故障不会把 i’way 回传本身一起回滚。

### 验收

- i’way 回传成功后自动发送司机信息。
- 相同信息重复确认不骚扰客人。
- 换司机后再次回传会发送更新。
- WhatsApp 失败不会破坏 i’way 回传事实。

---

## WP5 — Order Detail, Exceptions & QA / 订单详情、异常入口和最终验收

### 订单详情

在完整订单页增加轻量“客人沟通”区域：

- 第一轮发送记录；
- 机场指引发送记录；
- 客人原始回复；
- 解析后的确认/行李；
- 司机信息发送记录；
- 手动重新发送第一轮；
- 手动补发机场指引；
- 手动重新发送司机信息。

主页不增加“客人已确认”常驻列。

### 主页异常

只把需要人处理的事情纳入现有“异常订单”体系或等价入口，例如：

- 客人联系方式无效；
- WhatsApp 最终发送失败；
- 机场样地址无法识别；
- 机场已识别但缺指引；
- 客人说订单有误；
- 客人回复无法理解；
- 行李明显异常；
- 行李超车型承载；
- 司机资料不足导致无法通知。

### 导航文案

当前侧栏仍写着“人工发送模式：微信与 WhatsApp 只生成、复制，不会自动发送”。Phase 2 上线后必须更新，否则会和实际行为冲突。

### 测试

至少覆盖：

- airport matcher 单元测试；
- T-24h eligibility（是否应发送）测试；
- 幂等/重复 cron 测试；
- 区域开关测试；
- 缺机场指引但核心消息仍发送；
- driver snapshot diff（司机快照差异）测试；
- reply parser（回复解析）测试；
- 关键 mobile smoke（移动端冒烟测试）。

最终必须跑：

- `npm run typecheck`
- `npm run build`
- 与 Phase 2 直接相关的测试

---

## Agent Split Plan / Agent 拆分方案

不要 6 个 Agent 同时开工。

建议顺序：

`WP0 → WP1 → WP2 → WP3 与 WP4 可在 WP2 稳定后部分并行 → WP5 收口`

### Agent A — Foundation / 基础架构

负责 WP1：Prisma 数据结构、机场指引、机场识别、区域配置。

### Agent B — Outbound Messaging / 主动发送

负责 WP2：消息模板、批量预览、WhatsApp sender、T-24h cron、重试/幂等。

依赖 WP0 和 WP1。

### Agent C — Inbound Intelligence / 客人回复理解

负责 WP3：webhook 入站消息、规则解析、Qwen fallback、行李结构化、订单异议。

依赖 WP0、WP1，最好在 WP2 的 communication 模型稳定后开始。

### Agent D — i’way Hook / i’way 联动

负责 WP4：在 `confirmIwayReturn` 周边接入第二轮通知和司机快照比较。

避免大改现有 i’way 生成/复制逻辑。

### Integration pass / 集成收口

最后由一个 Agent 负责 WP5，只做整合、异常展示、订单详情和针对性回归，不重构前四个 Agent 已完成模块。

---

## 推荐的提交/PR 节奏

为了减少回滚成本，每个大工作包单独 commit/PR，不要整个 Phase 2 变成一个巨型 PR。

推荐：

1. `phase2: add airport guide foundation`
2. `phase2: add customer first contact workflow`
3. `phase2: add inbound customer reply parsing`
4. `phase2: notify customer after iway return`
5. `phase2: finish communication exceptions and qa`

数据库 migration 所在的 PR 属于高风险改动，需要在合并前做一次定点审查；普通 UI/模板小改仍按低成本验收流程处理。

---

## 当前代码基础判断

基于当前 `main`：

- 已有 Prisma/PostgreSQL，可以直接扩展数据模型。
- `Order` 已有 `passengerPhone`、航班、地址、人数、`luggage` 等基础字段。
- 已有 Supabase 依赖，可优先评估用于机场指引图片存储。
- 已有 Qwen JSON 调用封装，可复用于“复杂客人回复理解”，不需要再接一套 AI。
- 已有 Vercel Cron + `CRON_SECRET` 机制，可复用做 T-24h 自动检查。
- i’way 的正式确认动作集中在 `confirmIwayReturn(batchId)`，是第二轮通知最自然的挂接点。
- 当前导航仍声明 WhatsApp 为“人工发送模式”，Phase 2 最终上线时必须同步修改。

## 第一条实际开发指令

Phase 2 不建议一上来就让 Codex 写全部功能。

第一步只给 Codex：**WP0 WhatsApp 接入技术探路**。

得到真实的 WhatsApp Business/API 约束后，再锁定 WP1 数据模型和发送架构。