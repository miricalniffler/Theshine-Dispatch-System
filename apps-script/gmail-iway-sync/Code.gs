/**
 * The Shine Gmail iWay new-order bridge.
 *
 * Paste this file into a standalone Google Apps Script project owned by the
 * Gmail account that receives iWay orders. Secrets belong in Script Properties
 * only; never paste them into this source file.
 */

var IWAY_SENDERS = ['control@iwayex.com', 'noreply@iway.ru'];
var LOOKBACK_DAYS = 7;
var MAX_THREADS = 20;

function setupIwayGmailSync() {
  var props = PropertiesService.getScriptProperties();
  requireConfig_(props);
  // The first activation starts from now. Historical mail remains untouched.
  props.setProperty('IWAY_GMAIL_ENABLED_AT', new Date().toISOString());
  props.deleteProperty('IWAY_GMAIL_SEEN');
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
    var messages = collectNewOrderMessages_(enabledAt, seen);
    if (!messages.length) return;
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
  } finally {
    lock.releaseLock();
  }
}

function collectNewOrderMessages_(enabledAt, seen) {
  var byId = {};
  // One bounded search is intentionally cheaper than a separate full scan for
  // each sender.  Exact sender validation still happens below and again on the
  // server, so this broader Gmail search does not weaken the trust boundary.
  var senderQuery = IWAY_SENDERS.map(function (sender) { return 'from:' + sender; }).join(' OR ');
  GmailApp.search('(' + senderQuery + ') newer_than:' + LOOKBACK_DAYS + 'd', 0, MAX_THREADS).forEach(function (thread) {
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
  return Object.keys(byId).sort().slice(0, 20).map(function (id) { return byId[id]; });
}

function getSeen_(props) {
  try { return JSON.parse(props.getProperty('IWAY_GMAIL_SEEN') || '{}'); }
  catch (_) { return {}; }
}

function saveSeen_(props, seen) {
  var cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
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
