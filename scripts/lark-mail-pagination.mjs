/**
 * Read every page returned by lark-cli's mail +triage shortcut. Restarting a
 * run starts from the first page again; database message-ID deduplication is
 * the durable progress marker, so an interrupted fetch cannot skip a page.
 */
export function fetchAllTriagePages(runCli, { mailbox, sender, pageSize = 400 }) {
  const messages = [];
  const seenTokens = new Set();
  const seenMessageIds = new Set();
  let pageToken = "";
  let count = 0;

  do {
    const args = [
      "mail", "+triage", "--as", "user", "--mailbox", mailbox,
      "--filter", JSON.stringify({ from: [sender] }),
      "--max", String(pageSize), "--format", "json",
    ];
    if (pageToken) args.push("--page-token", pageToken);

    const result = runCli(args);
    if (!Array.isArray(result.messages)) {
      throw new Error("lark-cli 邮件列表响应缺少 messages 数组，已停止同步以避免漏单。");
    }
    // A shifting mailbox can repeat items across pages. Deduplicate by stable
    // message ID and fail closed if the provider cannot identify an item.
    for (const message of result.messages) {
      const id = message?.message_id;
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("lark-cli 邮件列表缺少有效 message_id，已停止同步以避免漏单。");
      }
      if (!seenMessageIds.has(id)) {
        seenMessageIds.add(id);
        messages.push(message);
      }
    }
    count += Number(result.count ?? result.messages.length);

    if (!result.has_more) break;
    if (!result.messages.length) {
      throw new Error("lark-cli 分页显示仍有邮件但返回空页，已停止同步以避免漏单。");
    }
    const next = String(result.page_token || "");
    if (!next || seenTokens.has(next)) {
      throw new Error("lark-cli 邮件列表分页令牌缺失或重复，已停止同步以避免漏单。");
    }
    seenTokens.add(next);
    pageToken = next;
  } while (true);

  return { messages, count };
}
