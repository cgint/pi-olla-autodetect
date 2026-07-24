import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PI_DIR = join(homedir(), ".pi");
const SETTINGS_FILE = join(PI_DIR, "olla", "settings.json");

interface OllaSettings {
  /** Olla server base URL (default: http://127.0.0.1:40114) */
  baseUrl?: string;
  /** Provider name registered in pi (default: olla) */
  providerName?: string;
  /** API key sent to Olla (default: no-api-key-needed) */
  apiKey?: string;
}

function readSettings(): OllaSettings {
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as OllaSettings;
    }
  } catch {
    // file doesn't exist or is invalid — use defaults
  }
  return {};
}

function resolveBaseUrl(settings: OllaSettings): string {
  return process.env["OLLA_BASE_URL"] ?? settings.baseUrl ?? "http://127.0.0.1:40114";
}

function resolveProviderName(settings: OllaSettings): string {
  return process.env["OLLA_PROVIDER_NAME"] ?? settings.providerName ?? "olla";
}

function resolveApiKey(settings: OllaSettings): string {
  return process.env["OLLA_API_KEY"] ?? settings.apiKey ?? "no-api-key-needed";
}

// ---------------------------------------------------------------------------
// URL normalization — ensure the URL ends with /v1 regardless of input
// pattern (host, host/prefix, host/prefix/v1, host/prefix/v1/)
// ---------------------------------------------------------------------------

/**
 * Ensure the URL ends with /v1. Strips trailing slash, then appends /v1
 * if not already ending with it.
 *
 * Examples:
 *   "http://pluto:40114"                    → "http://pluto:40114/v1"
 *   "http://pluto:40114/olla/openai"        → "http://pluto:40114/olla/openai/v1"
 *   "http://pluto:40114/olla/openai/v1"     → "http://pluto:40114/olla/openai/v1"
 *   "http://pluto:40114/olla/openai/v1/"    → "http://pluto:40114/olla/openai/v1"
 */
function ensureV1Url(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (!url.endsWith("/v1")) {
    url = `${url}/v1`;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Model discovery — fetch models from Olla's OpenAI-compatible endpoint
// ---------------------------------------------------------------------------

interface OllaModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OllaModelsResponse {
  object: string;
  data: OllaModel[];
}

/**
 * Fetch the model list from Olla's models endpoint.
 * Uses a 2s timeout so a dead Olla doesn't block pi startup for long.
 */
export async function discoverModels(v1Url: string, apiKey?: string): Promise<OllaModel[]> {
  const url = `${v1Url}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey && apiKey !== "no-api-key-needed") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      throw new Error(`Olla models endpoint returned ${response.status}: ${response.statusText}`);
    }

    const body = (await response.json()) as OllaModelsResponse;
    return body.data ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  const settings = readSettings();
  const baseUrl = resolveBaseUrl(settings);
  const v1Url = ensureV1Url(baseUrl);
  const providerName = resolveProviderName(settings);
  const apiKey = resolveApiKey(settings);

  let models: OllaModel[];
  try {
    console.log(`[olla] Discovering models from ${v1Url}...`);
    models = await discoverModels(v1Url, apiKey);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[olla] Model discovery failed: ${detail}. Olla models unavailable. Configure with OLLA_BASE_URL or ~/.pi/olla/settings.json.`);
    models = [];
  }

  pi.registerProvider(providerName, {
    name: "Olla Gateway",
    baseUrl: v1Url,
    api: "openai-completions",
    apiKey,
    models: models.map((m) => ({
      id: m.id,
      name: m.id,
      reasoning: true,
      input: ["text", "image"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_048_576,
      maxTokens: 32_768,
    })),
  });
}
