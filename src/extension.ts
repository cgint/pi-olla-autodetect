import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PI_DIR = join(homedir(), ".pi");
const SETTINGS_FILE = join(PI_DIR, "olla", "settings.json");
export const DEFAULT_CONTEXT_WINDOW = 262_144;

interface OllaSettings {
  baseUrl?: string;
  providerName?: string;
  apiKey?: string;
}

export interface OllaModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

type RegisteredModel = {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevelMap: { off: string };
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

function readSettings(): OllaSettings {
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as OllaSettings;
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

export function ensureV1Url(raw: string): string {
  const url = raw.replace(/\/+$/, "");
  return url.endsWith("/v1") ? url : `${url}/v1`;
}

function requestHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey && apiKey !== "no-api-key-needed") headers["Authorization"] = `Bearer ${apiKey}`;
  return headers;
}

export async function discoverModels(v1Url: string, apiKey?: string): Promise<OllaModel[]> {
  const url = `${v1Url}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: requestHeaders(apiKey) });
    if (!response.ok) throw new Error(`Gateway models endpoint returned ${response.status}: ${response.statusText}`);
    const body = (await response.json()) as { data?: OllaModel[] };
    return body.data ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Build generic Pi model registrations from the gateway's public OpenAI catalog. */
export function buildRegisteredModels(models: OllaModel[]): RegisteredModel[] {
  return models.map((model) => ({
    id: model.id,
    name: model.id,
    reasoning: true,
    thinkingLevelMap: { off: "none" },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: 32_768,
  }));
}

export default async function (pi: ExtensionAPI) {
  const settings = readSettings();
  const v1Url = ensureV1Url(resolveBaseUrl(settings));
  const providerName = resolveProviderName(settings);
  const apiKey = resolveApiKey(settings);
  let models: OllaModel[] = [];

  try {
    console.log(`[olla] Discovering models from ${v1Url}...`);
    models = await discoverModels(v1Url, apiKey);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[olla] Model discovery failed: ${detail}. Gateway models unavailable. Configure with OLLA_BASE_URL or ~/.pi/olla/settings.json.`);
  }

  pi.registerProvider(providerName, {
    name: "Olla Gateway",
    baseUrl: v1Url,
    api: "openai-completions",
    apiKey,
    models: buildRegisteredModels(models),
  });
}
