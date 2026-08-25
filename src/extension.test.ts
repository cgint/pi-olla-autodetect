import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: readFileSyncMock }));

import registerOllaProvider, { buildRegisteredModels, discoverModels } from "./extension.js";

const discoveredModels = {
  object: "list",
  data: [
    { id: "qwen3.8-27b-6000pro", object: "model", created: 1, owned_by: "olla" },
    { id: "deepseek-v4-flash-dspark", object: "model", created: 2, owned_by: "olla" },
  ],
};

function response(json: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => json } as Response;
}

const OLLA_ENV_KEYS = ["OLLA_BASE_URL", "OLLA_PROVIDER_NAME", "OLLA_API_KEY"] as const;
type OllaEnvKey = typeof OLLA_ENV_KEYS[number];

function saveOllaEnvironment(): Map<OllaEnvKey, string | undefined> {
  return new Map(OLLA_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function clearOllaEnvironment(): void {
  for (const key of OLLA_ENV_KEYS) delete process.env[key];
}

function restoreOllaEnvironment(saved: Map<OllaEnvKey, string | undefined>): void {
  for (const key of OLLA_ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("Olla registration", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let savedEnvironment: Map<OllaEnvKey, string | undefined>;

  beforeEach(() => {
    savedEnvironment = saveOllaEnvironment();
    clearOllaEnvironment();
    readFileSyncMock.mockReset();
    readFileSyncMock.mockImplementation(() => { throw new Error("settings unavailable"); });
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    restoreOllaEnvironment(savedEnvironment);
  });

  it("makes one public OpenAI models request and registers its catalog with defaults", async () => {
    fetchSpy.mockResolvedValue(response(discoveredModels));
    const registerProvider = vi.fn();

    await registerOllaProvider({ registerProvider } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:40114/v1/models", expect.objectContaining({ signal: expect.any(AbortSignal), headers: { Accept: "application/json" } }));
    expect(registerProvider).toHaveBeenCalledWith("olla", expect.objectContaining({
      baseUrl: "http://127.0.0.1:40114/v1",
      apiKey: "no-api-key-needed",
      models: expect.arrayContaining([
        expect.objectContaining({ id: "qwen3.8-27b-6000pro" }),
        expect.objectContaining({ id: "deepseek-v4-flash-dspark" }),
      ]),
    }));
  });

  it("uses settings when OLLA environment variables are absent", async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ baseUrl: "http://settings.example/gateway", providerName: "settings-olla", apiKey: "settings-key" }));
    fetchSpy.mockResolvedValue(response(discoveredModels));
    const registerProvider = vi.fn();

    await registerOllaProvider({ registerProvider } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);

    expect(fetchSpy).toHaveBeenCalledWith("http://settings.example/gateway/v1/models", expect.objectContaining({ headers: { Accept: "application/json", Authorization: "Bearer settings-key" } }));
    expect(registerProvider).toHaveBeenCalledWith("settings-olla", expect.objectContaining({ baseUrl: "http://settings.example/gateway/v1", apiKey: "settings-key" }));
  });

  it("prefers OLLA environment variables over settings", async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ baseUrl: "http://settings.example/gateway", providerName: "settings-olla", apiKey: "settings-key" }));
    process.env.OLLA_BASE_URL = "http://environment.example/gateway/v1";
    process.env.OLLA_PROVIDER_NAME = "environment-olla";
    process.env.OLLA_API_KEY = "environment-key";
    fetchSpy.mockResolvedValue(response(discoveredModels));
    const registerProvider = vi.fn();

    await registerOllaProvider({ registerProvider } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);

    expect(fetchSpy).toHaveBeenCalledWith("http://environment.example/gateway/v1/models", expect.objectContaining({ headers: { Accept: "application/json", Authorization: "Bearer environment-key" } }));
    expect(registerProvider).toHaveBeenCalledWith("environment-olla", expect.objectContaining({ baseUrl: "http://environment.example/gateway/v1", apiKey: "environment-key" }));
  });

  it("registers generic metadata with the conservative context fallback", () => {
    const models = buildRegisteredModels(discoveredModels.data);

    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "qwen3.8-27b-6000pro", contextWindow: 262144 }),
      expect.objectContaining({ id: "deepseek-v4-flash-dspark", contextWindow: 262144 }),
    ]));
    for (const model of models) {
      expect(model.thinkingLevelMap).toEqual({ off: "none" });
      expect(model).not.toHaveProperty("compat");
    }
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
    await expect(discoverModels("http://example.com/v1", "key")).rejects.toThrow("Gateway models endpoint returned 401: Unauthorized");
  });
});
