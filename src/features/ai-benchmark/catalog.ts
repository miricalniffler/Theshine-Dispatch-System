export type BenchmarkProvider = "qwen" | "deepseek" | "glm";

type ModelOption = { id: string; label: string; imageInput: true; verification: "documentation" | "live" };
type ProviderConfig = { id: BenchmarkProvider; label: string; defaultModelId: string; models: readonly ModelOption[]; regions?: readonly { id: string; label: string }[] };

// The browser never chooses an endpoint: this allow-list is resolved on the server.
const providers: Record<BenchmarkProvider, ProviderConfig> = {
  qwen: { id: "qwen", label: "Qwen（阿里云百炼）", defaultModelId: "qwen3.7-plus", models: [
    { id: "qwen3-vl-flash", label: "Qwen3-VL-Flash（现有默认）", imageInput: true, verification: "documentation" },
    { id: "qwen3.7-plus", label: "Qwen3.7-Plus（备用）", imageInput: true, verification: "documentation" },
    { id: "qwen3.7-flash", label: "Qwen3.7-Flash（候选）", imageInput: true, verification: "documentation" },
  ], regions: [{ id: "cn-beijing", label: "北京" }, { id: "ap-southeast-1", label: "新加坡" }] },
  deepseek: { id: "deepseek", label: "DeepSeek", defaultModelId: "deepseek-flash", models: [{ id: "deepseek-flash", label: "DeepSeek Flash", imageInput: true, verification: "documentation" }] },
  glm: { id: "glm", label: "GLM（智谱）", defaultModelId: "glm-5.3-flash", models: [
    { id: "glm-5.3-flash", label: "GLM-5.3-Flash（主模型）", imageInput: true, verification: "documentation" },
    { id: "glm-4.6v-flash", label: "GLM-4.6V-Flash（旧版对照）", imageInput: true, verification: "documentation" },
  ] },
};

export type ResolvedSelection = { provider: BenchmarkProvider; modelId: string; region?: string };

export function publicCatalog() { return Object.values(providers).map(({ id, label, defaultModelId, models, regions }) => ({ id, label, defaultModelId, models, regions: regions ?? [] })); }

export function resolveSelections(value: unknown): Record<BenchmarkProvider, ResolvedSelection> {
  const requested = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return (Object.keys(providers) as BenchmarkProvider[]).reduce((result, provider) => {
    const config = providers[provider];
    const input = requested[provider] && typeof requested[provider] === "object" ? requested[provider] as Record<string, unknown> : {};
    const modelId = typeof input.modelId === "string" ? input.modelId : config.defaultModelId;
    if (!config.models.some((model) => model.id === modelId)) throw new Error(`UNSUPPORTED_MODEL:${provider}`);
    const requestedRegion = typeof input.region === "string" ? input.region : undefined;
    if (requestedRegion && !config.regions?.some((region) => region.id === requestedRegion)) throw new Error(`UNSUPPORTED_REGION:${provider}`);
    result[provider] = { provider, modelId, ...(config.regions ? { region: requestedRegion ?? config.regions[0].id } : {}) };
    return result;
  }, {} as Record<BenchmarkProvider, ResolvedSelection>);
}
