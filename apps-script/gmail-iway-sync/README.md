# Gmail iWay 新订单同步

此脚本只读取可信 iWay 发件人的“新订单”邮件；取消、修改和其他邮件都不会提交给调度系统。

## 先在隔离测试环境启用

测试时，**绝不能填写正式网站地址或正式令牌**。应使用 Vercel Preview 的 HTTPS 地址，并由 Preview 环境变量连接到独立测试数据库。

1. 在 Google Apps Script 新建**独立脚本**，粘贴 `Code.gs` 内容。
2. 在脚本的“项目设置 → 脚本属性”填写：
   - `IWAY_GMAIL_INGEST_URL`：测试 Preview 的 `/api/import-sync/gmail-iway` 地址；
   - `IWAY_GMAIL_INGEST_TOKEN`：仅用于该 Preview 的一次性高强度令牌；
   - `IWAY_GMAIL_TARGET_ENVIRONMENT`：`preview`。
   - 如果 Preview 保留 Vercel 访问保护：`IWAY_GMAIL_VERCEL_PROTECTION_BYPASS_SECRET`：仅用于 Vercel 的自动化绕过密钥。它使 Apps Script 能访问此 Preview，不会关闭网页保护，也不会传给调度系统。
3. 首次执行 `setupIwayGmailSync`，按 Google 页面完成 Gmail 读取及外部网络访问授权。

首次执行会把当前时间保存为水位线，只处理之后收到的新邮件；不会追溯历史订单。之后的频率调整必须使用 `configureIwayGmailHourlyTrigger`，不能再次运行初始化函数。

## 频率和免费额度

脚本使用每小时一次的定时触发器。Google 平台会有少量调度延迟，并非整点秒级执行。脚本会保存 Gmail 搜索分页位置，并在相邻页重叠扫描；邮件积压时每轮只提交最多 20 封、后续小时继续处理，避免旧的“只看前 20 个会话”造成漏单。若 Gmail 或网络持续很慢，仍可能触发当天配额限制，次日会自动恢复。部署后应在 Apps Script 的“执行记录”观察实际耗时。

## 生产环境改为每小时与启用首页“同步 Gmail”

以下操作由拥有 Gmail 与 Apps Script 权限的 Work 人员完成；**不要运行** `setupIwayGmailSync`，它会重设同步起点。

1. 将新版 `Code.gs` 部署为新的 Web App 版本；以脚本所有者身份执行，并使用 Google 提供的 `/exec` 地址。
2. 在 Apps Script 的脚本属性新增 `IWAY_GMAIL_MANUAL_TRIGGER_SECRET`，填入一条新的高强度随机值。
3. 在 Vercel **Production** 环境添加相同值的 `IWAY_GMAIL_MANUAL_TRIGGER_SECRET`，并添加 Apps Script `/exec` 地址为 `IWAY_GMAIL_MANUAL_TRIGGER_URL`。两者均不能设置到 Preview，也不能写入源码。
4. 在 Apps Script 编辑器只执行一次 `configureIwayGmailHourlyTrigger`。该函数只替换定时器为每小时一次，保留既有水位线、去重记录和扫描分页位置。
5. 在正式网站登录后点击“同步 Gmail”。页面会先发出一个不读取 Gmail 的签名状态探针；只有确认新版 Apps Script 已部署且密钥一致，按钮才会启用。点击后，Vercel 服务器才使用签名请求 Apps Script；浏览器不会取得 Google 或 Apps Script 密钥。只有 Apps Script 返回最终结果后，页面才显示成功。

Apps Script Web App 的地址可以公开访问，但每次手动请求均须通过 HMAC 签名、5 分钟时效和一次性 nonce 校验；无效、过期或重放请求不会触发 Gmail 扫描。若 Apps Script 返回配额限制，首页会明确显示“Gmail 配额不足，同步失败”。

## 安全行为

- 邮件只会发送到脚本属性中指定的 HTTPS 导入接口；服务端会核对 `preview` / `production` 目标环境，目标不一致时拒绝写入。
- Vercel 自动化绕过密钥（如使用）只放在 Apps Script 属性中；它不是订单导入令牌，也不会写进代码或日志。
- 邮件编号会在 Google 端和服务端各自去重，脚本重启不会重复导入。
- 服务端再次核验可信发件人、主题、邮件格式、时间水位线和订单号。
- 解析失败的邮件不会写入订单，会留下不含正文的可追踪处理状态；原始邮件正文不会进入 Apps Script 日志。
- 脚本不发送 WhatsApp/iWay 消息，也不处理取消或修改邮件。

## 通过测试后再切换 Production

Production 必须使用**不同的**地址、令牌和目标环境值：

- `IWAY_GMAIL_INGEST_URL=https://dispatch.theshinetrip.com/api/import-sync/gmail-iway`；这是稳定的 Production 域名，不能使用每次部署都会变化的 Preview 地址；
- Production 的 `IWAY_GMAIL_INGEST_TOKEN` 与 Preview 完全不同；
- Production 的 `IWAY_GMAIL_TARGET_ENVIRONMENT=production`；
- Apps Script 的 `IWAY_GMAIL_TARGET_ENVIRONMENT=production`；
- 部署新版后只运行 `configureIwayGmailHourlyTrigger`；它不会重设水位线，也不会回放旧邮件。

若邮件由其他邮箱转发而来，系统仍只接受邮件 `From` 头中精确匹配的 iWay 发件地址，不会因为转发邮箱或显示名称而放宽来源校验。
