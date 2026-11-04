/**
 * The Shine Gmail iWay new-order bridge.
 *
 * Paste this file into a standalone Google Apps Script project owned by the
 * Gmail account that receives iWay orders. Secrets belong in Script Properties
 * only; never paste them into this source file.
 */

var IWAY_SENDERS = ['control@iwayex.com', 'noreply@iway.ru', 'booking@iwayex.com'];
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
  installIwayGmailHourlyTrigger_();
}

// Use this when changing an already-running project to the hourly schedule.
// Unlike setupIwayGmailSync, it never changes the Gmail activation waterline,
// seen-message cache, or pagination cursor.
function configureIwayGmailHourlyTrigger() {
  var props = PropertiesService.getScriptProperties();
  requireConfig_(props);
  var enabledAt = new Date(props.getProperty('IWAY_GMAIL_ENABLED_AT'));
  if (isNaN(enabledAt.getTime())) throw new Error('IWAY_GMAIL_ENABLED_AT 未设置；为保护同步起点，不能自动初始化。');
  installIwayGmailHourlyTrigger_();
}

function installIwayGmailHourlyTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncIwayGmailOrders') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('syncIwayGmailOrders').timeBased().everyHours(1).create();
}

function syncIwayGmailOrders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status: 'IN_PROGRESS' };
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
      return { status: 'SUCCEEDED', summary: emptySummary_() };
    }
    var headers = { Authorization: 'Bearer ' + props.getProperty('IWAY_GMAIL_INGEST_TOKEN') };
    // Preview deployments can keep Vercel SSO enabled. When a Vercel
    // automation-bypass secret is explicitly placed in Script Properties, use
    // it only for this server-to-server request; it is never logged or sent to
    // the application itself.
    var protectionBypass = props.getProperty('IWAY_GMAIL_VERCEL_PROTECTION_BYPASS_SECRET');
    if (protectionBypass) headers['x-vercel-protection-bypass'] = protectionBypass;
    var response = UrlFetchApp.fetch(props.getProperty('IWAY_GMAIL_INGEST_URL'), {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
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
    return { status: 'SUCCEEDED', summary: syncSummary_(payload && payload.data) };
  } finally {
    lock.releaseLock();
  }
}

// This endpoint is intentionally cryptographically authenticated even though
// Apps Script web apps use a public delivery URL. Only the Vercel server holds
// the matching secret; browser clients never see it.
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    verifyManualTrigger_(props, e, 'sync');
    return jsonResponse_(syncIwayGmailOrders());
  } catch (error) {
    return jsonResponse_({ status: 'FAILED', code: manualTriggerErrorCode_(error) });
  }
}

// The dashboard calls this signed probe before enabling the manual button.
// It validates the deployed script and secrets but never reads Gmail.
function doGet(e) {
  try {
    verifyManualTrigger_(PropertiesService.getScriptProperties(), e, 'status');
    return jsonResponse_({ status: 'READY' });
  } catch (error) {
    return jsonResponse_({ status: 'UNAVAILABLE', code: manualTriggerErrorCode_(error) });
  }
}

function emptySummary_() { return { created: 0, cancelled: 0, review: 0, skipped: 0, rejected: 0 }; }

function syncSummary_(data) {
  data = data || {};
  return {
    created: Number(data.created || 0),
    cancelled: Number(data.cancelled || 0),
    review: Number(data.review || 0),
    skipped: Number(data.skipped || 0),
    rejected: Number(data.rejected || 0),
  };
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function verifyManualTrigger_(props, e, expectedAction) {
  requireConfig_(props);
  var secret = props.getProperty('IWAY_GMAIL_MANUAL_TRIGGER_SECRET');
  if (!secret) throw new Error('MANUAL_TRIGGER_NOT_CONFIGURED');
  var request;
  try { request = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : (e && e.parameter || null); }
  catch (_) { throw new Error('MANUAL_TRIGGER_INVALID_REQUEST'); }
  if (!request || request.action !== expectedAction || typeof request.issuedAt !== 'string' || typeof request.nonce !== 'string' || typeof request.signature !== 'string') throw new Error('MANUAL_TRIGGER_INVALID_REQUEST');
  var issuedAt = new Date(request.issuedAt);
  if (isNaN(issuedAt.getTime()) || Math.abs(Date.now() - issuedAt.getTime()) > 5 * 60 * 1000) throw new Error('MANUAL_TRIGGER_EXPIRED');
  if (request.nonce.length < 16 || request.nonce.length > 200) throw new Error('MANUAL_TRIGGER_INVALID_REQUEST');
  var expected = Utilities.base64Encode(Utilities.computeHmacSha256Signature(request.action + '\n' + request.issuedAt + '\n' + request.nonce, secret));
  if (!safeEquals_(expected, request.signature)) throw new Error('MANUAL_TRIGGER_INVALID_SIGNATURE');
  var cache = CacheService.getScriptCache();
  var replayKey = 'manual-trigger:' + request.nonce;
  if (cache.get(replayKey)) throw new Error('MANUAL_TRIGGER_REPLAYED');
  cache.put(replayKey, '1', 600);
}

function safeEquals_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  var diff = 0;
  for (var i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function manualTriggerErrorCode_(error) {
  var text = (String(error && error.message || '') + ' ' + String(error || '')).replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '');
  if (/Service invoked too many times|quota|limit exceeded|daily limit|(?:调用次数|配额|限额).*gmail|gmail.*(?:调用次数|配额|限额)|gmail.*(?:回数が多すぎ|割り当て|上限)/i.test(text)) return 'GMAIL_QUOTA_EXHAUSTED';
  text = String(error && error.message || error || '');
  if (/^MANUAL_TRIGGER_[A-Z_]+$/.test(text)) return text;
  return 'GMAIL_MANUAL_SYNC_FAILED';
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
        var lifecycle = /^(?:CANCELLATION|AMENDMENT)\b/i.test(subject);
        var newOrder = /^(?:transfer\s+service\s+order|new\s+ride\s*#)/i.test(subject);
        if (!lifecycle && !newOrder) return;
        var text = message.getPlainBody();
        if (!lifecycle && !isStructuredNewOrder_(text)) return;
        byId[id] = {
          id: id,
          sender: message.getFrom(),
          subject: subject,
          receivedAt: message.getDate().toISOString(),
          text: text,
          fields: lifecycle ? extractLifecycleFields_(message.getBody()) : [],
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
    && ((/Itinerary\s*[:：]/i.test(text) && /Clients\s*[:：]/i.test(text))
      || (/Transfer\s*[:：]/i.test(text) && /Passengers\s*[:：]/i.test(text)
        && /Pick-up date\s*[:：]/i.test(text) && /Local pick-up time\s*[:：]/i.test(text)));
}

function isTrustedSender_(from) {
  var match = String(from || '').match(/<([^>]+)>/);
  var address = (match ? match[1] : from || '').trim().toLowerCase();
  return IWAY_SENDERS.indexOf(address) !== -1;
}

// Parse the actual table cells, dropping struck-through previous values from
// current text. No HTML or remote resources are sent to/rendered by the UI.
function extractLifecycleFields_(html) {
  var labels = /^(?:Ride number|City|Pick-up date|Local pick-up time|Vehicle class|Pax|Transfer|Flight number|Greeting sign|Additional remarks|i[’']way notes|Additional services|Passengers):?$/i;
  var cells = String(html || '').match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || [];
  var result = [];
  for (var i = 0; i < cells.length - 1; i++) {
    var label = htmlText_(cells[i]);
    if (!labels.test(label)) continue;
    var value = cells[i + 1];
    var previous = [];
    var current = value.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (_, tag, old) {
      previous.push(htmlText_(old)); return '';
    });
    // CSS deletion markers cannot be safely removed by this small parser.
    // Leave this field unavailable, forcing human review rather than guessing.
    if (/text-decoration[^;"']*line-through/i.test(current)) continue;
    result.push({ label: label.replace(/:$/, ''), current: htmlText_(current), previous: previous });
  }
  return result;
}
function htmlText_(html) {
  return String(html).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, function (_, n) { return String.fromCharCode(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)); })
    .replace(/&rArr;/g, '⇒').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}
