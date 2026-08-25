# pi-olla-autodetect

Pi extension that discovers models from an OpenAI-compatible gateway and registers them as a provider. Its `OLLA_*` configuration names are retained for compatibility with existing Olla installations.

## Why

In a homelab with multiple inference hosts, models start and stop on demand, endpoints change constantly, and maintaining a static `models.json` with dozens of direct provider entries becomes a chore.

**pi-olla-autodetect removes that maintenance burden.** Point Pi at one OpenAI-compatible gateway and let this extension discover the public models it exposes.

```
┌──────────────┐
│  Pi agent    │  ← sees one stable provider
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Gateway    │  ← owns routing and request adaptation
└──────┬───────┘
       │
  ┌────┼────┐
  ▼    ▼    ▼
backend backend backend
```

### Benefits

- **One stable endpoint** — Pi points to the gateway, not individual inference hosts
- **Automatic model discovery** — models appear in Pi as soon as the gateway exposes them; no `models.json` edits
- **No stale entries** — when a model goes away, it disappears from Pi on `/reload`
- **Gateway-owned adaptation** — routing, backend compatibility, and request adaptation stay at the gateway boundary

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

At startup (and on `/reload`), the extension fetches exactly `{baseUrl}/models` and registers the returned public OpenAI model catalog via `pi.registerProvider()`. Each registered model uses generic Pi metadata, including a conservative `262,144`-token context-window fallback. The extension does not inspect gateway-private metadata or adapt requests for individual backends.

## Configuration

| Setting | Env var | Default | Description |
|---------|---------|---------|-------------|
| `baseUrl` | `OLLA_BASE_URL` | `http://127.0.0.1:40114` | OpenAI-compatible gateway URL (any form accepted — host, host+prefix, host+prefix/v1 — normalized to `/v1`) |
| `providerName` | `OLLA_PROVIDER_NAME` | `olla` | Provider name registered in Pi |
| `apiKey` | `OLLA_API_KEY` | `no-api-key-needed` | API key sent to the gateway |

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

Run `/reload` in Pi to re-fetch the public model catalogue from the gateway.

## Requirements

- pi >= 0.74.0
- A reachable OpenAI-compatible gateway with a public `/v1/models` endpoint

## License

MIT
