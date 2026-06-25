---
name: connect-self-hosted-https
description: Connect the infracodebase MCP server to a self-hosted API over HTTPS, including handling self-signed certificates. Use when wiring the server to a non-SaaS instance (e.g. https://localhost:3000 or an internal host), when the server logs "could not reach <url>", or when you hit TLS errors like SELF_SIGNED_CERT_IN_CHAIN / UNABLE_TO_VERIFY_LEAF_SIGNATURE.
---

# Connect the infracodebase MCP server to a self-hosted HTTPS API

The server takes all configuration from **environment variables (or flags)** supplied
by the MCP client — there is no `init`, no `auth login`, and no stored config file.
Connecting to a self-hosted instance means setting two (sometimes three) env vars in
the client's server definition.

## The variables

| Variable | Purpose | Required |
| --- | --- | --- |
| `INFRACODEBASE_TOKEN` | Personal access token (`icb_pat_...`) | Yes |
| `INFRACODEBASE_API_URL` | Your instance's API base, e.g. `https://infra.acme.com/api/v1` | Yes for self-hosted (defaults to the SaaS) |
| `NODE_EXTRA_CA_CERTS` | Path to your CA cert — only for HTTPS with a private/self-signed cert | Only if TLS fails |

## Step 1 — point at your instance

Use the `--env` flag (repeatable) on `claude mcp add`. The `--` separates Claude's
flags from the command that launches the server.

Via npx (published package):

```bash
claude mcp add infracodebase \
  --env INFRACODEBASE_TOKEN=icb_pat_xxx \
  --env INFRACODEBASE_API_URL=https://infra.acme.com/api/v1 \
  -- npx -y @infracodebase/mcp@latest
```

From a local clone (after `npm install && npm run build`):

```bash
claude mcp add infracodebase \
  --env INFRACODEBASE_TOKEN=icb_pat_xxx \
  --env INFRACODEBASE_API_URL=https://localhost:3000/api/v1 \
  -- node /abs/path/to/infracodebase-mcp/dist/index.js
```

Equivalent `mcp.json` (Claude Desktop / Cursor / etc.):

```json
{
  "mcpServers": {
    "infracodebase": {
      "command": "npx",
      "args": ["-y", "@infracodebase/mcp@latest"],
      "env": {
        "INFRACODEBASE_TOKEN": "icb_pat_xxx",
        "INFRACODEBASE_API_URL": "https://infra.acme.com/api/v1"
      }
    }
  }
}
```

Add `--scope user` (or set it in user config) to make the server available across all
projects instead of just the current one.

## Step 2 — handle the certificate (HTTPS only)

Plain `http://` (e.g. `http://localhost:3000`) needs nothing further — skip this step.

For `https://` with a **CA-signed** cert (most public/internal hosts), it also just
works. The problem is only **self-signed or private-CA** certs: Node's `fetch` rejects
them and the server logs:

```
[infracodebase-mcp] ⚠ could not reach https://localhost:3000/api/v1
```

with an underlying `SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

> **Don't test the cert with `curl`.** On macOS `curl` trusts the system keychain, so
> `curl https://localhost:3000` can return happily (even a 404 means TLS succeeded)
> while Node still rejects the same cert — Node uses its own bundled CA store and
> ignores the OS keychain. Test with Node itself:
>
> ```bash
> node -e 'fetch("https://localhost:3000/api/v1").then(r=>console.log("OK",r.status)).catch(e=>console.log(e.cause?.code||e.message))'
> ```
>
> Re-run it with `NODE_EXTRA_CA_CERTS=/path/to/rootCA.pem node -e '...'` to confirm the
> cert fixes it before wiring up the server.

### Preferred: trust your CA (surgical)

Export the issuing CA/root cert and point Node at it. This keeps verification on for
every other connection.

```bash
claude mcp add infracodebase \
  --env INFRACODEBASE_TOKEN=icb_pat_xxx \
  --env INFRACODEBASE_API_URL=https://localhost:3000/api/v1 \
  --env NODE_EXTRA_CA_CERTS=/abs/path/to/rootCA.pem \
  -- node /abs/path/to/infracodebase-mcp/dist/index.js
```

Getting the cert:
- mkcert: it's `"$(mkcert -CAROOT)/rootCA.pem"`. If the `mkcert` binary isn't on PATH
  (common — the CA outlives the install), the root lives at a fixed default:
  macOS `~/Library/Application Support/mkcert/rootCA.pem`,
  Linux `~/.local/share/mkcert/rootCA.pem`.
- Otherwise export the server's cert chain: `openssl s_client -connect localhost:3000 -showcerts`.
  This emits the leaf **and** the issuing CA; the CA is the cert whose subject == issuer.

### Alternative: use the OS trust store (Node 22.15+/23+)

If mkcert (or your admin) already installed the CA into the system keychain — which is
why `curl` trusts it — a new enough Node can use that store directly, no cert file
needed: pass `--use-system-ca`. Caveats: the flag doesn't exist before Node 22.15, and
on 22.x it's **not** allowed in `NODE_OPTIONS` (only as a direct CLI flag), so it's
awkward to inject through an MCP `command`/`args` block. On older Node, prefer
`NODE_EXTRA_CA_CERTS` above.

### Last resort: disable TLS verification (blunt)

```
--env NODE_TLS_REJECT_UNAUTHORIZED=0
```

This turns off **all** certificate verification for the server process — every HTTPS
call it makes is now unauthenticated, not just the one to your instance. Only use it
for throwaway local dev, never anything reachable beyond your machine, and prefer
`NODE_EXTRA_CA_CERTS`.

## Step 3 — verify

```bash
claude mcp get infracodebase     # Status should be ✓ connected
claude mcp list                  # quick health check across servers
```

You can also run the server by hand to read the preflight line directly:

```bash
INFRACODEBASE_TOKEN=icb_pat_xxx \
INFRACODEBASE_API_URL=https://localhost:3000/api/v1 \
NODE_EXTRA_CA_CERTS=/abs/path/to/rootCA.pem \
node /abs/path/to/infracodebase-mcp/dist/index.js
```

On success it logs `Ready - connected to <url>`. The preflight is non-blocking, so the
server still starts even on failure — `tools/list` works, but tool calls that hit the
API will error until the connection is fixed.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No infracodebase token found` | `INFRACODEBASE_TOKEN` missing from the env block | Add it to `--env` / `mcp.json` `env` |
| `⚠ could not reach <url>` + `SELF_SIGNED_CERT_IN_CHAIN` | Self-signed/private-CA HTTPS cert | Set `NODE_EXTRA_CA_CERTS` (or, last resort, `NODE_TLS_REJECT_UNAUTHORIZED=0`) |
| `curl` succeeds but the server still can't reach the URL | Cert is in the OS keychain (curl trusts it) but not Node's CA bundle | Set `NODE_EXTRA_CA_CERTS`; verify with the `node -e fetch(...)` one-liner, not curl |
| `⚠ could not reach <url>` (no cert error) | Wrong URL, wrong port, or instance down | Check `INFRACODEBASE_API_URL` (include the `/api/v1` path) and that the API is running |
| `⚠ token rejected (HTTP 401/403)` | Token invalid/expired or wrong instance | Get a fresh token from your instance's settings; confirm token matches the URL |
| Server connects but a tool errors | API reachable but request rejected | Re-check token scope and that the token belongs to this instance |

## Notes

- After changing any `--env` value, remove and re-add the server (or edit `mcp.json`)
  and restart the client — env is read once at process start.
- `claude mcp add` defaults to `--scope local` (current project only).
- Precedence is flag (`--token`/`--api-url`) > env var > default. Flags are handy for a
  one-off manual run; the MCP client should use `env`.
