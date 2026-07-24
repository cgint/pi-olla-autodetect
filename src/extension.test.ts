import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { discoverModels } from "./extension.js";

describe("discoverModels", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const okResponse = {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      object: "list",
      data: [{ id: "test-model", object: "model", created: 1, owned_by: "olla" }],
    }),
  } as Response;

  const unauthorizedResponse = {
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    json: async () => ({}),
  } as Response;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("should send Authorization header when apiKey is provided", async () => {
    fetchSpy.mockResolvedValue(okResponse);

    await discoverModels("http://example.com/v1", "my-secret-key");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example.com/v1/models",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer my-secret-key",
        },
      })
    );
  });

  it("should NOT send Authorization header when apiKey is the default placeholder", async () => {
    fetchSpy.mockResolvedValue(okResponse);

    await discoverModels("http://example.com/v1", "no-api-key-needed");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example.com/v1/models",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
        },
      })
    );
  });

  it("should NOT send Authorization header when apiKey is undefined", async () => {
    fetchSpy.mockResolvedValue(okResponse);

    await discoverModels("http://example.com/v1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example.com/v1/models",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
        },
      })
    );
  });

  it("should throw on non-2xx response", async () => {
    fetchSpy.mockResolvedValue(unauthorizedResponse);

    await expect(discoverModels("http://example.com/v1", "key")).rejects.toThrow(
      "Olla models endpoint returned 401: Unauthorized"
    );
  });


});
