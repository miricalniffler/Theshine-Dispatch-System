/**
 * The Shine Gmail iWay new-order bridge.
 *
 * Paste this file into a standalone Google Apps Script project owned by the
 * Gmail account that receives iWay orders. Secrets belong in Script Properties
 * only; never paste them into this source file.
 */

var IWAY_SENDERS = ['control@iwayex.com', 'noreply@iway.ru'];
var THREAD_PAGE_SIZE = 50;
var MESSAGE_BATCH_SIZE = 20;
var SCAN_OVERLAP_THREADS = 10;

function setupIwayGmailSync() {
  var props = PropertiesService.getScriptProperties();
  requireConfig_(props);
  // The first activation starts from now. Historical mail remains untouched.
  props.setProperty('IWAY_GMAIL_ENABLED_AT', new Date().toISOString());
  props.deleteProperty('IWAY_GMAIL_SEEN');
  props.setProperty('IWAY_GMAIL_SCAN_OFFSET', '0');
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncIwayGmailOrders') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('syncIwayGmailOrders').timeBased().everyMinutes(1).create();
}

function syncIwayGmailOrders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    requireConfig_(props);
    var enabledAt = new Date(props.getProperty('IWAY_GMAIL_ENABLED_AT'));
    if (isNaN(enabledAt.getTime())) throw new Error('IWAY_GMAIL_ENABLED_AT 未设置。请先运行 setupIwayGmailSync。');
    var seen = getSeen_(props);
    var page = collectNewOrderMessages_(enabledAt, seen, props);
    var messages = page.messages;
    if (!messages.length) {
      if (page.threadCount) advanceScanOffset_(props, page.threadCount);
      return;
    }
    var response = UrlFetchApp.fetch(props.getProperty('IWAY_GMAIL_INGEST_URL'), {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + props.getProperty('IWAY_GMAIL_INGEST_TOKEN') },
      payload: JSON.stringify({
        targetEnvironment: props.getProperty('IWAY_GMAIL_TARGET_ENVIRONMENT'),
        messages: messages,
      }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('导入服务返回 HTTP ' + response.getResponseCode());
    var payload = JSON.parse(response.getContentText());
    var processed = payload && payload.data && Array.isArray(payload.data.processedIds) ? payload.data.processedIds : [];
    processed.forEach(function (id) { seen[id] = Date.now(); });
    saveSeen_(props, seen);
    // Keep the same page until every eligible message in it is acknowledged.
    // This makes a temporary network/server failure retryable without skipping
    // mail, while the server-side external-id constraint makes retries safe.
    if (processed.length === messages.length && page.remainingEligible === messages.length) {
      advanceScanOffset_(props, page.threadCount);
    }
  } finally {
    lock.releaseLock();
  }
}

function collectNewOrderMessages_(enabledAt, seen, props) {
  var byId = {};
  // GmailApp.search is paged.  The old 20-thread first-page-only strategy could
  // starve older mail when a mailbox was backlogged.  A persistent offset plus
  // overlap walks every result page over later trigger runs; duplicates are
  // harmless because both the script and server record processed message ids.
  var senderQuery = IWAY_SENDERS.map(function (sender) { return 'from:' + sender; }).join(' OR ');
  var queryStart = Utilities.formatDate(new Date(enabledAt.getTime() - 24 * 60 * 60 * 1000), 'Etc/UTC', 'yyyy/MM/dd');
  var offset = Number(props.getProperty('IWAY_GMAIL_SCAN_OFFSET') || '0');
  var threads = GmailApp.search('(' + senderQuery + ') after:' + queryStart, offset, THREAD_PAGE_SIZE);
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
        var id = message.getId();
        if (seen[id] || message.getDate().getTime() <= enabledAt.getTime()) return;
        if (!isTrustedSender_(message.getFrom())) return;
        var subject = message.getSubject() || '';
        // Only new-order notices reach the server. Cancellation, amendment,
        // and arbitrary email are deliberately not submitted by this bridge.
        if (!/^(?:transfer\s+service\s+order|new\s+ride\s*#)/i.test(subject)) return;
        if (/\b(?:cancel(?:led|lation)?|void|amendment|modified?|change(?:d)?)\b/i.test(subject)) return;
        var text = message.getPlainBody();
        if (!isStructuredNewOrder_(text)) return;
        byId[id] = {
          id: id,
          sender: message.getFrom(),
          subject: subject,
          receivedAt: message.getDate().toISOString(),
          text: text,
        };
    });
  });
  var eligibleIds = Object.keys(byId).sort(function (left, right) {
    return new Date(byId[left].receivedAt).getTime() - new Date(byId[right].receivedAt).getTime();
  });
  return {
    messages: eligibleIds.slice(0, MESSAGE_BATCH_SIZE).map(function (id) { return byId[id]; }),
    remainingEligible: eligibleIds.length,
    threadCount: threads.length,
  };
}

function advanceScanOffset_(props, threadCount) {
  var current = Number(props.getProperty('IWAY_GMAIL_SCAN_OFFSET') || '0');
  // Re-read a small overlap to tolerate Gmail result reordering/deletion.
  // Server idempotency avoids duplicate orders; this is safer than skipping a
  // mail that moved across a page boundary while the trigger was waiting.
  if (threadCount < THREAD_PAGE_SIZE) {
    props.setProperty('IWAY_GMAIL_SCAN_OFFSET', '0');
  } else {
    props.setProperty('IWAY_GMAIL_SCAN_OFFSET', String(Math.max(0, current + threadCount - SCAN_OVERLAP_THREADS)));
  }
}

function getSeen_(props) {
  try { return JSON.parse(props.getProperty('IWAY_GMAIL_SEEN') || '{}'); }
  catch (_) { return {}; }
}

function saveSeen_(props, seen) {
  var cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  Object.keys(seen).forEach(function (id) { if (seen[id] < cutoff) delete seen[id]; });
  props.setProperty('IWAY_GMAIL_SEEN', JSON.stringify(seen));
}

function requireConfig_(props) {
  ['IWAY_GMAIL_INGEST_URL', 'IWAY_GMAIL_INGEST_TOKEN', 'IWAY_GMAIL_TARGET_ENVIRONMENT'].forEach(function (key) {
    if (!props.getProperty(key)) throw new Error(key + ' 未设置。');
  });
  var target = props.getProperty('IWAY_GMAIL_TARGET_ENVIRONMENT');
  if (target !== 'preview' && target !== 'production') throw new Error('IWAY_GMAIL_TARGET_ENVIRONMENT 只能是 preview 或 production。');
}

function isStructuredNewOrder_(text) {
  return /Ride number\s*[:：]/i.test(text)
    && /Vehicle class\s*[:：]/i.test(text)
    && /Itinerary\s*[:：]/i.test(text)
    && /Clients\s*[:：]/i.test(text);
}

function isTrustedSender_(from) {
  var match = String(from || '').match(/<([^>]+)>/);
  var address = (match ? match[1] : from || '').trim().toLowerCase();
  return IWAY_SENDERS.indexOf(address) !== -1;
}
