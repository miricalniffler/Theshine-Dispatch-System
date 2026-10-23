# Gmail iWay 新订单同步

此脚本只读取可信 iWay 发件人的“新订单”邮件；取消、修改和其他邮件都不会提交给调度系统。

## 启用前需要的三项配置

1. 在 Google Apps Script 新建**独立脚本**，粘贴 `Code.gs` 内容。
2. 在脚本的“项目设置 → 脚本属性”填写：
   - `IWAY_GMAIL_INGEST_URL`：正式网站的 `/api/import-sync/gmail-iway` 地址；
   - `IWAY_GMAIL_INGEST_TOKEN`：由部署人员生成的一次性高强度令牌。
3. 首次执行 `setupIwayGmailSync`，按 Google 页面完成 Gmail 读取及外部网络访问授权。

首次执行会把当前时间保存为水位线，只处理之后收到的新邮件；不会追溯历史订单。Google 的分钟触发器由平台调度，实际执行可能有少量延迟，并非秒级定时。

## 安全行为

- 邮件只会发送到固定的 Production HTTPS 导入接口。
- 邮件编号会在 Google 端和服务端各自去重，脚本重启不会重复导入。
- 服务端再次核验可信发件人、主题、邮件格式、时间水位线和订单号。
- 解析失败的邮件不会写入订单，可在修复格式后重试；原始邮件正文不会进入 Apps Script 日志。
- 脚本不发送 WhatsApp/iWay 消息，也不处理取消或修改邮件。
