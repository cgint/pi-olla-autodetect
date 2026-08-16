# pi-olla-autodetect

Pi extension that auto-discovers models from an [Olla](https://github.com/thushan/olla) gateway and registers them as a provider.

## Why

In a homelab with multiple inference hosts, models start and stop on demand, endpoints change constantly, and maintaining a static `models.json` with dozens of direct provider entries becomes a chore.

**pi-olla-autodetect removes that maintenance burden.** Instead of wiring each backend directly into Pi, you deploy one Olla gateway in front of your inference nodes and let this extension discover whatever models are currently available.

```
┌──────────────┐
│  Pi agent    │  ← sees one stable "olla" provider
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Olla gateway │  ← handles health checks, failover, routing
└──────┬───────┘
       │
  ┌────┼────┐
  ▼    ▼    ▼
sparky sparkz twins
```

### Benefits

- **One stable endpoint** — Pi points to Olla, not to individual inference hosts
- **Automatic model discovery** — models appear in Pi as soon as Olla reports them; no `models.json` edits
- **No stale entries** — when a model goes away, it disappears from Pi on `/reload`
- **Health checks handled by Olla** — offline backends are dropped without client-facing errors
- **Works alongside Open WebUI** — both Pi and Open WebUI can share the same Olla gateway

## Install

```bash
pi install npm:pi-olla-autodetect
```

For local development:

```bash
pi install /path/to/pi-olla-autodetect
```

Then run `/reload`.

## How It Works

At startup (and on `/reload`), the extension fetches `{baseUrl}/models` from your Olla instance and registers all returned models under an `olla` provider via `pi.registerProvider()`. It reads Olla's public catalog (`/olla/models`) for each model's context window, using a conservative `262,144`-token fallback when catalog context is missing or invalid, and detailed status (`/internal/status/models?detailed=true`) for its configured backend type.

### Backend compatibility

Compatibility follows Olla's configured backend type, not model IDs or hosts. SGLang models receive a compatibility override that sends developer messages as `system` and omits `reasoning_effort`; vLLM models retain Pi's defaults. Unknown or unavailable status retains Pi defaults and emits a warning.

## Configuration

| Setting | Env var | Default | Description |
|---------|---------|---------|-------------|
| `baseUrl` | `OLLA_BASE_URL` | `http://127.0.0.1:40114` | Olla server URL (any form accepted — host, host+prefix, host+prefix/v1 — normalized to `/v1`) |
| `providerName` | `OLLA_PROVIDER_NAME` | `olla` | Provider name registered in pi |
| `apiKey` | `OLLA_API_KEY` | `no-api-key-needed` | API key sent to Olla |

Settings file: `~/.pi/olla/settings.json`

```json
{ "baseUrl": "http://127.0.0.1:40114/olla/openai/v1" }
```

Or override via environment variables:

```bash
export OLLA_BASE_URL=http://pluto:40114/olla/openai/v1
```

The extension normalizes any input format — bare host, host with prefix, or full `/v1` URL — so all of these work:

```bash
OLLA_BASE_URL=http://pluto:40114
OLLA_BASE_URL=http://pluto:40114/olla/openai
OLLA_BASE_URL=http://pluto:40114/olla/openai/v1
```

## Update Model List

Run `/reload` in Pi to re-fetch the model catalogue from Olla.

## Requirements

- pi >= 0.74.0
- A reachable Olla gateway with `model_registry.enable_unifier: true`

## License

MIT