/**
 * Central allow-list for paid providers. Values from browser requests are
 * never used as model IDs or provider URLs.
 */
export const AI_MODELS = {
  vehicleVision: {
    primary: { provider: "GLM", model: "glm-5.3-flash", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", timeoutMs: 30_000 },
    fallback: { provider: "QWEN", model: "qwen3.7-plus", timeoutMs: 30_000 },
  },
} as const;
