# pi-olla-autodetect

Pi extension that discovers models from an [Olla](https://github.com/thushan/olla) gateway and registers them as a provider via `pi.registerProvider()`.

At startup (or `/reload`), the extension fetches `/olla/openai/v1/models` and registers an `olla` provider with whatever models Olla reports.

## Install

```bash
pi install https://github.com/cgint/pi-olla-autodetect
```

Or add to `~/.pi/agent/settings.json` packages:

```json
{ "packages": ["../../dev-external/pi-olla-autodetect"] }
```

Then run `/reload`.

## Configuration

| Setting | Env var | Default | Description |
|---------|---------|---------|-------------|
| `baseUrl` | `OLLA_BASE_URL` | `http://pluto:40114` | Olla server URL |
| `providerName` | `OLLA_PROVIDER_NAME` | `olla` | Provider name registered in pi |
| `apiKey` | `OLLA_API_KEY` | `no-api-key-needed` | API key sent to Olla |

Settings file: `~/.pi/olla/settings.json`

```json
{ "baseUrl": "http://pluto:40114" }
```

## Update model list

`/reload` re-fetches models from Olla.

## Requirements

- pi >= 0.74.0
- Reachable Olla gateway

## License

MIT
