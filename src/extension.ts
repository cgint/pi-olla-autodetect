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

export interface OllaCatalogModel {
  id: string;
  family?: string;
  maxContextLength?: number;
}

export interface OllaModelStatus {
  name: string;
  type: string;
}

type CompatProfile = {
  supportsDeveloperRole: false;
  supportsReasoningEffort: false;
  thinkingFormat?: "qwen-chat-template";
};
type RegisteredModel = {
  id: string;
  name: string;
  reasoning: boolean;
  compat?: CompatProfile;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

/** Profiles are keyed only by Olla's configured backend type. */
export const BACKEND_PROFILES: Readonly<Record<string, CompatProfile | undefined>> = Object.freeze({
  sglang: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  vllm: undefined,
});

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

/** Derive Olla's root-relative catalog and detailed-status routes from its V1 URL. */
export function deriveOllaUrls(v1Url: string): { catalogUrl: string; detailedStatusUrl: string } {
  const gatewayUrl = new URL(v1Url);
  return {
    catalogUrl: new URL("/olla/models", gatewayUrl).toString(),
    detailedStatusUrl: new URL("/internal/status/models?detailed=true", gatewayUrl).toString(),
  };
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
    if (!response.ok) throw new Error(`Olla models endpoint returned ${response.status}: ${response.statusText}`);
    const body = (await response.json()) as { data?: OllaModel[] };
    return body.data ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: requestHeaders(apiKey) });
    if (!response.ok) throw new Error(`Olla endpoint returned ${response.status}: ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Parse the public catalog's array, `models`, or `data` response shape. */
export function parseCatalog(body: unknown): OllaCatalogModel[] {
  const records = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { models?: unknown }).models)
      ? (body as { models: unknown[] }).models
      : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
        ? (body as { data: unknown[] }).data
        : [];
  return records.flatMap((record) => {
    if (!record || typeof record !== "object" || typeof (record as { id?: unknown }).id !== "string") return [];
    const olla = (record as { olla?: { family?: unknown; max_context_length?: unknown } }).olla;
    return [{
      id: (record as { id: string }).id,
      family: typeof olla?.family === "string" ? olla.family : undefined,
      maxContextLength: typeof olla?.max_context_length === "number" ? olla.max_context_length : undefined,
    }];
  });
}

export function parseDetailedStatus(body: unknown): OllaModelStatus[] {
  const records = body && typeof body === "object" && Array.isArray((body as { recent_models?: unknown }).recent_models)
    ? (body as { recent_models: unknown[] }).recent_models
    : [];
  return records.flatMap((record) => record && typeof record === "object" && typeof (record as { name?: unknown }).name === "string" && typeof (record as { type?: unknown }).type === "string"
    ? [{ name: (record as { name: string }).name, type: (record as { type: string }).type }]
    : []);
}

export function resolveBackendProfile(status: OllaModelStatus | undefined, catalogModel?: OllaCatalogModel): { compat?: CompatProfile; warning?: string } {
  if (!status) return { warning: "no detailed status" };
  if (!(status.type in BACKEND_PROFILES)) return { warning: `unknown backend type ${status.type}` };
  const compat = BACKEND_PROFILES[status.type];
  if (status.type === "sglang" && catalogModel?.family === "qwen") {
    return { compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, thinkingFormat: "qwen-chat-template" } };
  }
  if (status.type === "sglang") return { compat, warning: "Qwen template control was not applied because catalog family is missing or not qwen" };
  return { compat };
}

function contextWindow(maxContextLength: number | undefined): number {
  return typeof maxContextLength === "number" && Number.isFinite(maxContextLength) && maxContextLength > 0
    ? maxContextLength
    : DEFAULT_CONTEXT_WINDOW;
}

/** Build Pi models and diagnostics from catalog/status data without I/O. */
export function buildRegisteredModels(models: OllaModel[], catalog: OllaCatalogModel[], statuses: OllaModelStatus[]): { models: RegisteredModel[]; warnings: string[] } {
  const catalogById = new Map(catalog.map((model) => [model.id, model]));
  const statusByName = new Map(statuses.map((status) => [status.name, status]));
  const warnings: string[] = [];
  const registered = models.map((model) => {
    const profile = resolveBackendProfile(statusByName.get(model.id), catalogById.get(model.id));
    if (profile.warning) {
      const retainedCompatibility = profile.compat ? "SGLang base compatibility" : "Pi default compatibility";
      warnings.push(`[olla] Model ${model.id}: ${profile.warning}; retaining ${retainedCompatibility}.`);
    }
    return {
      id: model.id,
      name: model.id,
      reasoning: true,
      ...(profile.compat ? { compat: profile.compat } : {}),
      input: ["text", "image"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindow(catalogById.get(model.id)?.maxContextLength),
      maxTokens: 32_768,
    };
  });
  return { models: registered, warnings };
}

export default async function (pi: ExtensionAPI) {
  const settings = readSettings();
  const v1Url = ensureV1Url(resolveBaseUrl(settings));
  const providerName = resolveProviderName(settings);
  const apiKey = resolveApiKey(settings);
  let models: OllaModel[] = [];
  let catalog: OllaCatalogModel[] = [];
  let statuses: OllaModelStatus[] = [];

  try {
    console.log(`[olla] Discovering models from ${v1Url}...`);
    models = await discoverModels(v1Url, apiKey);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[olla] Model discovery failed: ${detail}. Olla models unavailable. Configure with OLLA_BASE_URL or ~/.pi/olla/settings.json.`);
  }

  try {
    const urls = deriveOllaUrls(v1Url);
    const [catalogResult, statusResult] = await Promise.allSettled([
      fetchJson(urls.catalogUrl, apiKey),
      fetchJson(urls.detailedStatusUrl, apiKey),
    ]);
    if (catalogResult.status === "fulfilled") catalog = parseCatalog(catalogResult.value);
    else console.warn(`[olla] Public catalog unavailable: ${catalogResult.reason instanceof Error ? catalogResult.reason.message : String(catalogResult.reason)}.`);
    if (statusResult.status === "fulfilled") statuses = parseDetailedStatus(statusResult.value);
    else console.warn(`[olla] Detailed model status unavailable: ${statusResult.reason instanceof Error ? statusResult.reason.message : String(statusResult.reason)}.`);
  } catch (err) {
    console.warn(`[olla] Unable to derive Olla metadata URLs: ${err instanceof Error ? err.message : String(err)}.`);
  }

  const registered = buildRegisteredModels(models, catalog, statuses);
  registered.warnings.forEach((warning) => console.warn(warning));
  pi.registerProvider(providerName, {
    name: "Olla Gateway",
    baseUrl: v1Url,
    api: "openai-completions",
    apiKey,
    models: registered.models,
  });
}
