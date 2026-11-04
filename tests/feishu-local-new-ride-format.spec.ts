import { test, expect } from '@playwright/test';
import { isLocalNewOrderSubject, parseLocalNewRide, localMailOrderNumber } from '../scripts/iway-local-new-ride.mjs';

const meta = { subject: 'New ride #1173316.', date: '2026-11-04T15:21:00Z' };
const message = { message_id: 'test-new-ride', body_plain_text: `Ride number: #1173316
Date: 05.11
Time: 19:10
Vehicle class: Minivan
Itinerary:
From: airport Kuala Lumpur International terminal 1
To: Kuala Lumpur, Test hotel
Flight number/train number: VN681
Pick up time: 2026-11-05 19:10:00
Remarks:
Number of passengers: 1
Clients: Test Passenger, phone 15102098006
Meeting tablet: Test Passenger` };

test('飞书接受无 iway 字样的严格 New ride 主题，拒绝修改取消及询价', () => {
  expect(isLocalNewOrderSubject(meta.subject)).toBeTruthy();
  expect(isLocalNewOrderSubject("Transfer service order #1 173 316 (i’way)")).toBeTruthy();
  for (const subject of ['Cancellation of ride #1173316.', 'AMENDMENT to the transfer #1173316 (i’way)', 'Re: New ride #1173316.', 'Price request 1173316', 'New ride #1173316. cancelled']) expect(isLocalNewOrderSubject(subject)).toBeFalsy();
});
test('1173316 格式：精确订单号、吉隆坡时区、显式日期、全部必填字段', () => {
  const parsed = parseLocalNewRide(message, meta);
  expect(parsed).toMatchObject({ orderNo: '1173316', city: '吉隆坡', serviceDate: '2026-11-05', passengerName: 'Test Passenger', passengerPhone: '15102098006', platformVehicleType: 'MINIVAN', adults: 1, otherNotes: null });
  expect(parsed?.pickupDateTime.toISOString()).toBe('2026-11-05T11:10:00.000Z');
});
test('身份时间冲突、无电话、非法日期及未知城市都不能创建订单', () => {
  for (const body of [message.body_plain_text.replace('#1173316', '#1173317'), message.body_plain_text.replace('2026-11-05 19:10:00', '2026-11-06 19:10:00'), message.body_plain_text.replace('phone 15102098006', 'phone '), message.body_plain_text.replace('05.11', '31.11'), message.body_plain_text.replaceAll('Kuala Lumpur', 'Unknown')]) expect(parseLocalNewRide({ ...message, body_plain_text: body }, meta)).toBeNull();
});
test('日期没有年份时按邮件收信时间跨年，明示行李 0 不改为人数', () => {
  const body = message.body_plain_text.replace('05.11', '05.01').replace('Pick up time: 2026-11-05 19:10:00\n', '').replace('Number of passengers: 1', 'Number of passengers: 1\nLuggage: 0');
  expect(parseLocalNewRide({ ...message, body_plain_text: body }, { ...meta, date: '2026-12-31T00:00:00Z' })).toMatchObject({ serviceDate: '2027-01-05', luggage: 0 });
});
test('两种邮件格式都能按精确订单号确认缓存，不会重复下载所有 New ride 正文', () => {
  expect(localMailOrderNumber(message.body_plain_text.replace(/\s+/g, ' '))).toBe('1173316');
  expect(localMailOrderNumber('Ride number: 1 173 316 City: Kuala Lumpur')).toBe('1173316');
  expect(localMailOrderNumber('Ride number: 1173316 <https://esforty.com/trips?number=1173316> City: Kuala Lumpur')).toBe('1173316');
  expect(localMailOrderNumber('Footer number: 1173316')).toBe('');
});
