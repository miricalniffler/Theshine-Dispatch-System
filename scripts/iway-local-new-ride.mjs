import { cityFromIwayOrder, serviceTimeZoneForLocalSync } from './iway-local-sync-city.mjs';

export function localMailOrderNumber(text) {
  const value = String(text || '').replace(/\u00a0/g, ' ').match(/\bRide number:\s*#?\s*([\d \t\u202f]+)(?=\s*(?:City:|Date:|\r?\n|$|[<\[]?https?:\/\/))/i)?.[1]?.replace(/\s/g, '') || '';
  return /^\d{5,12}$/.test(value) ? value : '';
}

export function isLocalNewOrderSubject(subject) {
  return /^New ride\s*#\s*\d{5,12}\.?\s*$/i.test(String(subject).trim())
    || /^Transfer service order\s*#[\d\s\u00a0\u202f]+\s*\(i[’']way\)\s*$/i.test(String(subject).trim());
}

// A separate format from the table-based Transfer service order. Only exact
// labelled values are used; missing/conflicting identity or time is rejected.
export function parseLocalNewRide(message, meta) {
  const text = String(message.body_plain_text || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  const labels = 'Ride number|Date|Time|Vehicle class|Itinerary|From|To|Flight number/train number|Pick up time|Departure time|Remarks|Number of passengers|Children|Adults|Luggage|Clients|Meeting tablet';
  const field = label => text.match(new RegExp(`(?:^|\\n|\\t)[ \\t]*(?:${label})[ \\t]*:[ \\t]*([\\s\\S]*?)(?=(?:\\n|\\t)[ \\t]*(?:${labels})[ \\t]*:|$)`, 'i'))?.[1]?.trim() || '';
  const subjectId = String(meta.subject).match(/^New ride\s*#\s*(\d{5,12})\.?\s*$/i)?.[1];
  const orderNo = field('Ride number').replace(/^#\s*/, '').replace(/\s/g, '');
  if (!subjectId || orderNo !== subjectId) return null;
  const pickupAddress = field('From').replace(/\s+/g, ' ').trim();
  const dropoffAddress = field('To').replace(/\s+/g, ' ').trim();
  const city = cityFromIwayOrder('', pickupAddress, dropoffAddress);
  const dateParts = field('Date').match(/^(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}))?$/);
  const time = field('Time').match(/^(\d{1,2}):(\d{2})$/);
  const explicitPickup = field('Pick up time').match(/^(20\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::\d{2})?$/);
  const receivedAt = new Date(meta.date);
  if (!city || !dateParts || !time || Number.isNaN(receivedAt.getTime()) || Number(time[1]) > 23 || Number(time[2]) > 59) return null;
  const [, day, month, statedYear] = dateParts;
  let year = statedYear || explicitPickup?.[1] || field('Departure time').match(/\b(20\d{2})\b/)?.[1];
  if (!year) {
    year = String(receivedAt.getUTCFullYear());
    if (Date.UTC(+year, +month - 1, +day) < Date.UTC(receivedAt.getUTCFullYear(), receivedAt.getUTCMonth(), receivedAt.getUTCDate())) year = String(+year + 1);
  }
  const serviceDate = `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
  const calendar = new Date(`${serviceDate}T00:00:00Z`);
  const pickupTime = `${time[1].padStart(2,'0')}:${time[2]}`;
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0,10) !== serviceDate) return null;
  if (explicitPickup && `${explicitPickup[1]}-${explicitPickup[2]}-${explicitPickup[3]} ${explicitPickup[4]}:${explicitPickup[5]}` !== `${serviceDate} ${pickupTime}`) return null;
  const clients = field('Clients');
  const phoneParts = clients.split(/,?\s*phone\s*:?\s+/i);
  const phones = [...new Set([...(phoneParts.slice(1).join(' ').replace(/[–—]/g, '-')).matchAll(/\+?\d[\d ()-]{5,}\d/g)].map(m => m[0].trim()))];
  const passengerName = phoneParts[0]?.trim();
  const platformVehicleType = field('Vehicle class').split('(')[0].trim().toUpperCase();
  const pax = Number(field('Number of passengers').match(/^\d+/)?.[0]);
  const children = Number(field('Children').match(/^\d+/)?.[0] || 0);
  if (!pickupAddress || !dropoffAddress || !passengerName || !phones.length || !platformVehicleType || !Number.isInteger(pax) || pax <= 0 || children > pax) return null;
  return {
    orderNo, city, serviceDate,
    pickupDateTime: new Date(`${serviceDate}T${pickupTime}:00${["Asia/Kuala_Lumpur", "Asia/Makassar"].includes(serviceTimeZoneForLocalSync(city)) ? '+08:00' : '+07:00'}`),
    pickupAddress, dropoffAddress, passengerName, passengerPhone: phones.join(' / '),
    flightNumber: field('Flight number/train number') || null, platformVehicleType, seatCount: null,
    adults: pax - children, children, luggage: Number(field('Luggage').match(/^\d+/)?.[0] || pax),
    meetGreetLine: field('Meeting tablet') || null, otherNotes: field('Remarks') || null,
    rawSource: text, sourceMessageId: message.message_id, sourceSubject: meta.subject, receivedAt,
  };
}
