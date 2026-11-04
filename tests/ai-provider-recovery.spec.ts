import { test, expect } from '@playwright/test';
import { recognizeFleetPackage } from '../src/features/assist/vision';
import { qwenJson } from '../src/features/assist/qwen';

test.describe('provider recovery', () => {
  test.describe.configure({ mode: 'serial' });
  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;
  test.beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    process.env.AI_VISION_REAL_CALLS_ENABLED = 'true';
    process.env.ZHIPU_API_KEY = 'test-key';
    process.env.DASHSCOPE_API_KEY = 'test-key';
  });
  test.afterEach(() => { global.fetch = originalFetch; process.env = originalEnv; });
  test('GLM timeout falls back once with the entire text and image package', async () => {
    const calls: any[] = [];
    global.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); calls.push(body);
      if (calls.length === 1) throw new DOMException('timed out', 'TimeoutError');
      return Response.json({ choices: [{ message: { content: JSON.stringify({ records: [{ order_number: '1170624', driver_name: 'AIM', license_plate: '7280', confidence: 'HIGH' }] }) } }] });
    };
    const result = await recognizeFleetPackage('1170624 AIM', ['data:image/png;base64,TEST'], ['1170624']);
    expect(result.provider).toBe('QWEN');
    expect(result.records[0].license_plate).toBe('7280');
    expect(calls).toHaveLength(2);
    expect(calls[0].reasoning_effort).toBe('low');
    expect(calls[0].thinking?.type).not.toBe('disabled');
    expect(calls[1].enable_thinking).toBe(false);
    expect(calls[1].messages).toEqual(calls[0].messages);
  });
  test('provider status is retained without exposing echoed private data', async () => {
    global.fetch = async () => Response.json({ error: { code: 'InvalidParameter', message: 'private payload must not be exposed' } }, { status: 400 });
    await expect(qwenJson([], 'qwen3.7-plus')).rejects.toThrow('QWEN_400_InvalidParameter');
  });
  test('dual failure distinguishes timeout and authorization failure', async () => {
    let calls = 0;
    global.fetch = async () => {
      if (++calls === 1) throw new DOMException('timed out', 'TimeoutError');
      return Response.json({ error: { code: 'InvalidApiKey' } }, { status: 401 });
    };
    const result = await recognizeFleetPackage('', ['data:image/png;base64,TEST'], []);
    expect(result.provider).toBe('NONE');
    expect(result.note).toContain('GLM 识别超时');
    expect(result.note).toContain('QWEN 账户或权限不可用');
  });
});
