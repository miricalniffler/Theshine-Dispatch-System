# 机场指引图片：Supabase Storage 待配置项

WP1A 已完成机场指引图片的数据库字段、上传接口和页面入口，但当前本机环境未配置以下两个服务端变量，因此系统会安全地保存文字指引，并在上传图片时提示“存储尚未配置”：

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_AIRPORT_GUIDES_BUCKET`

## 账号所有者需要完成

1. 在当前 Supabase 项目创建一个专用于机场指引的 Storage bucket；bucket 名称自行决定，例如 `airport-guides`。
2. 该 bucket 需要让已登录平台用户能读取图片。当前 WP1A 的页面使用 public object URL 显示指引图片，因此最小方案是将 bucket 配成公开读取；写入和删除仍只通过网站服务端 API 完成。
3. 在 Vercel 的 Production 与 Preview 环境变量中设置：
   - `SUPABASE_SERVICE_ROLE_KEY`：Supabase service role key；只允许服务端使用，绝不能提交 GitHub 或发到聊天。
   - `SUPABASE_AIRPORT_GUIDES_BUCKET`：上述 bucket 的实际名称。
4. 在本机 `.env` 使用同名变量，供本地测试；不要填进 `.env.example` 以外的版本控制文件。

## 已实现的保护

- 图片不进入 PostgreSQL；数据库只保存 bucket、path、文件名、MIME 类型、大小与排序信息。
- 上传只接受图片，单张最大 10MB。
- 未配置 Storage 时，系统不会伪造上传成功，也不会创建数据库图片记录。
- 删除时先删除 Supabase 对象，再删除数据库记录；存储未配置时拒绝删除，避免留下无法追踪的文件。

## 本阶段不做

- 不创建 Supabase bucket。
- 不设置 Supabase 权限策略。
- 不接入 Meta WhatsApp，也不向客户发送图片。
