import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import registerOllaProvider, { deriveOllaUrls, discoverModels } from "./extension.js";

const discoveredModels = {
  object: "list",
  data: [
    { id: "qwen3.8-27b-6000pro", object: "model", created: 1, owned_by: "olla" },
    { id: "deepseek-v4-flash-dspark", object: "model", created: 2, owned_by: "olla" },
  ],
};

const catalog = [
  { id: "qwen3.8-27b-6000pro", olla: { max_context_length: 262144 } },
  { id: "deepseek-v4-flash-dspark", olla: { max_context_length: 1048576 } },
];

const detailedStatus = {
  recent_models: [
    { name: "qwen3.8-27b-6000pro", type: "sglang" },
    { name: "deepseek-v4-flash-dspark", type: "vllm" },
  ],
};

function response(json: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => json } as Response;
}

describe("Olla registration", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("derives Olla catalog and detailed-status URLs from a configured V1 URL", () => {
    expect(deriveOllaUrls("http://pluto:40114/olla/openai/v1")).toEqual({
      catalogUrl: "http://pluto:40114/olla/models",
      detailedStatusUrl: "http://pluto:40114/internal/status/models?detailed=true",
    });
  });

  it("requests the public catalog and detailed status, then registers type-specific profiles", async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      switch (url) {
        case "http://pluto:40114/olla/openai/v1/models": return response(discoveredModels);
        case "http://pluto:40114/olla/models": return response(catalog);
        case "http://pluto:40114/internal/status/models?detailed=true": return response(detailedStatus);
        default: throw new Error(`unexpected fetch URL: ${url}`);
      }
    });
    const registerProvider = vi.fn();

    await registerOllaProvider({ registerProvider } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);

    expect(fetchSpy).toHaveBeenCalledWith("http://pluto:40114/olla/models", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetchSpy).toHaveBeenCalledWith("http://pluto:40114/internal/status/models?detailed=true", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const models = registerProvider.mock.calls[0]?.[1].models;
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "qwen3.8-27b-6000pro",
        contextWindow: 262144,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      }),
      expect.objectContaining({ id: "deepseek-v4-flash-dspark", contextWindow: 1048576 }),
    ]));
    expect(models.find((model: { id: string }) => model.id === "deepseek-v4-flash-dspark")).not.toHaveProperty("compat");
  });

  it("registers models with default compatibility and warnings when detailed status rejects", async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === "http://pluto:40114/olla/openai/v1/models") return response(discoveredModels);
      if (url === "http://pluto:40114/olla/models") return response(catalog);
      throw new Error("detailed status unavailable");
    });
    const registerProvider = vi.fn();

    await registerOllaProvider({ registerProvider } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);

    const models = registerProvider.mock.calls[0]?.[1].models;
    expect(models).toHaveLength(2);
    expect(models[0]).not.toHaveProperty("compat");
    expect(models[1]).not.toHaveProperty("compat");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Detailed model status unavailable"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("qwen3.8-27b-6000pro: no detailed status"));
  });

  it("registers models with fallback context and warnings when the public catalog rejects", async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === "http://pluto:40114/olla/openai/v1/models") return response(discoveredModels);
      if (url === "http://pluto:40114/internal/status/models?detailed=true") return response(detailedStatus);
      throw new Error("catalog unavailable");
    });
    const registerProvider = vi.fn();

    await registerOllaProvider({ registerProvider } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);

    const models = registerProvider.mock.calls[0]?.[1].models;
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ contextWindow: 262144, compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } });
    expect(models[1]).toMatchObject({ contextWindow: 262144 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Public catalog unavailable"));
  });

  it.each([undefined, 0, -1, Number.NaN])("uses the fallback context window for invalid catalog context %s", async (maxContext) => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === "http://pluto:40114/olla/openai/v1/models") return response({ object: "list", data: [discoveredModels.data[0]] });
      if (url === "http://pluto:40114/olla/models") return response([{ id: "qwen3.8-27b-6000pro", olla: { max_context_length: maxContext } }]);
      return response({ recent_models: [{ name: "qwen3.8-27b-6000pro", type: "sglang" }] });
    });
    const registerProvider = vi.fn();

    await registerOllaProvider({ registerProvider } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);

    expect(registerProvider.mock.calls[0]?.[1].models[0]).toMatchObject({ contextWindow: 262144 });
  });

  it("keeps Pi defaults and warns for unknown or unavailable backend status", async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === "http://pluto:40114/olla/openai/v1/models") return response(discoveredModels);
      if (url === "http://pluto:40114/olla/models") return response(catalog);
      return response({ recent_models: [{ name: "qwen3.8-27b-6000pro", type: "unknown-backend" }] });
    });
    const registerProvider = vi.fn();

    await registerOllaProvider({ registerProvider } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);

    const models = registerProvider.mock.calls[0]?.[1].models;
    expect(models[0]).not.toHaveProperty("compat");
    expect(models[1]).not.toHaveProperty("compat");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("qwen3.8-27b-6000pro"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown backend type"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deepseek-v4-flash-dspark"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no detailed status"));
  });
});

describe("discoverModels", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const okResponse = response({ object: "list", data: [{ id: "test-model", object: "model", created: 1, owned_by: "olla" }] });
  const unauthorizedResponse = { ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) } as Response;

  beforeEach(() => { fetchSpy = vi.spyOn(global, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("sends Authorization header when apiKey is provided", async () => {
    fetchSpy.mockResolvedValue(okResponse);
    await discoverModels("http://example.com/v1", "my-secret-key");
    expect(fetchSpy).toHaveBeenCalledWith("http://example.com/v1/models", expect.objectContaining({ headers: { Accept: "application/json", Authorization: "Bearer my-secret-key" } }));
  });

  it("does not send Authorization header for the default placeholder or undefined key", async () => {
    fetchSpy.mockResolvedValue(okResponse);
    await discoverModels("http://example.com/v1", "no-api-key-needed");
    await discoverModels("http://example.com/v1");
    expect(fetchSpy).toHaveBeenLastCalledWith("http://example.com/v1/models", expect.objectContaining({ headers: { Accept: "application/json" } }));
  });

  it("throws on non-2xx response", async () => {
    fetchSpy.mockResolvedValue(unauthorizedResponse);
    await expect(discoverModels("http://example.com/v1", "key")).rejects.toThrow("Olla models endpoint returned 401: Unauthorized");
  });
});
