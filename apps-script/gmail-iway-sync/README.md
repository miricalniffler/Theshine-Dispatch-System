# Gmail iWay 新订单同步

此脚本只读取可信 iWay 发件人的“新订单”邮件；取消、修改和其他邮件都不会提交给调度系统。

## 先在隔离测试环境启用

测试时，**绝不能填写正式网站地址或正式令牌**。应使用 Vercel Preview 的 HTTPS 地址，并由 Preview 环境变量连接到独立测试数据库。

1. 在 Google Apps Script 新建**独立脚本**，粘贴 `Code.gs` 内容。
2. 在脚本的“项目设置 → 脚本属性”填写：
   - `IWAY_GMAIL_INGEST_URL`：测试 Preview 的 `/api/import-sync/gmail-iway` 地址；
   - `IWAY_GMAIL_INGEST_TOKEN`：仅用于该 Preview 的一次性高强度令牌；
   - `IWAY_GMAIL_TARGET_ENVIRONMENT`：`preview`。
3. 首次执行 `setupIwayGmailSync`，按 Google 页面完成 Gmail 读取及外部网络访问授权。

首次执行会把当前时间保存为水位线，只处理之后收到的新邮件；不会追溯历史订单。Google 的分钟触发器由平台调度，实际执行可能有少量延迟，并非秒级定时。

## 频率和免费额度

脚本使用每分钟一次的定时触发器。这是 Google 支持的最短间隔，但不能保证每一秒都准时。免费 Gmail 账号的限制不只是邮件读取：Google 还限制每天所有定时脚本的累计运行时间为 **90 分钟**、URL 请求为 **20,000 次**、Gmail 读写为 **20,000 次**。脚本会保存 Gmail 搜索分页位置，并在相邻页重叠扫描；邮件积压时每轮只提交最多 20 封、后续触发器继续处理，避免旧的“只看前 20 个会话”造成漏单。若 Gmail 或网络持续很慢，仍可能触发 Google 的当天运行时间限制，次日会自动恢复。部署后应在 Apps Script 的“执行记录”观察实际耗时。

## 安全行为

- 邮件只会发送到脚本属性中指定的 HTTPS 导入接口；服务端会核对 `preview` / `production` 目标环境，目标不一致时拒绝写入。
- 邮件编号会在 Google 端和服务端各自去重，脚本重启不会重复导入。
- 服务端再次核验可信发件人、主题、邮件格式、时间水位线和订单号。
- 解析失败的邮件不会写入订单，会留下不含正文的可追踪处理状态；原始邮件正文不会进入 Apps Script 日志。
- 脚本不发送 WhatsApp/iWay 消息，也不处理取消或修改邮件。

## 通过测试后再切换 Production

Production 必须使用**不同的**地址、令牌和目标环境值：

- Production 的 `IWAY_GMAIL_INGEST_TOKEN` 与 Preview 完全不同；
- Production 的 `IWAY_GMAIL_TARGET_ENVIRONMENT=production`；
- Apps Script 的 `IWAY_GMAIL_TARGET_ENVIRONMENT=production`；
- 再次运行 `setupIwayGmailSync`，它会从切换时刻重新设置水位线，不回放旧邮件。

若邮件由其他邮箱转发而来，系统仍只接受邮件 `From` 头中精确匹配的 iWay 发件地址，不会因为转发邮箱或显示名称而放宽来源校验。
