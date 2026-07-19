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
 * Fetch the model list from Olla's unified models endpoint.
 * Uses a short timeout so a dead Olla doesn't block pi startup for long.
 */
async function discoverModels(baseUrl: string): Promise<OllaModel[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/olla/openai/v1/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
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
  const providerName = resolveProviderName(settings);
  const apiKey = resolveApiKey(settings);

  let models: OllaModel[];
  try {
    models = await discoverModels(baseUrl);
  } catch {
    console.warn(`[olla] No local AI gateway found. Olla models unavailable. Configure with OLLA_BASE_URL or ~/.pi/olla/settings.json.`);
    models = [];
  }

  pi.registerProvider(providerName, {
    name: "Olla Gateway",
    baseUrl: `${baseUrl.replace(/\/+$/, "")}/olla/openai/v1`,
    api: "openai-completions",
    apiKey,
    models: models.map((m) => ({
      id: m.id,
      name: m.id,
      reasoning: true,
      input: ["text"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_048_576,
      maxTokens: 32_768,
    })),
  });
}
