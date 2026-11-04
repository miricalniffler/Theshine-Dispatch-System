import { test,expect } from '@playwright/test';
import { orderBlocks } from '../src/features/fleet-replies/service';
import { parseIwayNewRide } from '../src/features/import/iway-new-ride-parser';
test('分组订单号和 M1 标签分别拆分，电话不成为订单边界',()=>{
 const text='1 168 331\n+60 123456789\nPassenger A\n04.11.2026 07:00\nM1 Order Number: 1169258\nDriver: B';
 const blocks=orderBlocks(text); expect(blocks).toHaveLength(2); expect(blocks[0]).toContain('+60 123456789'); expect(blocks[1]).toContain('1169258');
});
test('带制表符的邮件表格保留吉隆坡和当地日期时间',()=>{
 const text='Ride number:\t1169258\nCity:\tKuala Lumpur\nPick-up date:\tNovember 4, 2026\tLocal pick-up time:\t15:30 (3:30 PM)\nVehicle class:\tSTANDARD ("C")\nPax:\t1\nTransfer:\tairport Kuala Lumpur International terminal 1 ⇒ Kuala Lumpur, Test Hotel\nFlight number:\tGF165\nGreeting sign:\tTEST\nPassengers:\tTest Guest Phone: +7 900 0000000';
 const result=parseIwayNewRide(text); expect(result.platformOrderNumber).toBe('1169258');expect(result.city).toBe('吉隆坡');expect(result.pickupDateTime).toContain('2026-11-04T15:30');
});
