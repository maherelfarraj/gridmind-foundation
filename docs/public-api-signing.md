# GridMind EPC — Public API signing guide

This is the self-contained integrator reference for the `/api/public/hooks/*`
endpoints. If you are integrating a SCADA gateway, an automation platform, or
a lender's back-office, start here.

Spelling note: we spell **O&M** and **C&I** with plain ampersands throughout
copy and headers — no HTML entities in your payloads or documentation.

---

## 1. Get an API key

1. Ask a **company_admin** to open **Settings → API keys** and click
   **New key**.
2. Choose a **name** (e.g. `SCADA Ingest — Rajasthan Plant 1`) and the
   **scopes** you need. For plant telemetry the scope is
   `scada:telemetry:write`; for the low-risk generic hook it is
   `hooks:events`.
3. Copy the raw key immediately. It looks like
   `gm_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` and is shown **once**. If
   you lose it, rotate it — do not ask support to reveal it (only its SHA-256
   hash is stored).

The key doubles as the **HMAC signing secret** for signed endpoints.

---

## 2. Signing recipe

Every signed request needs two headers:

| Header        | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| `x-timestamp` | Current time in **Unix seconds** (integer, UTC).             |
| `x-signature` | `sha256=` + lowercase hex of `HMAC-SHA256(secret, message)`. |

The `message` is:

```
${timestamp}.${rawBody}
```

Rules:

- **Sign the exact bytes** you transmit. If you pretty-print or re-serialize
  the JSON after signing, verification will fail with `signature_invalid`.
- The server allows a **300-second** clock skew. Outside that window you get
  `signature_expired` — sync your host clock (NTP).
- Add `Authorization: Bearer gm_…` on every request. Signatures are
  additional — they never replace the Bearer key.

---

## 3. Runnable samples — hit `/api/public/hooks/ping`

The ping endpoint returns `{ pong: true, caller, companyId }` on success and
writes nothing. It is the canonical way to prove your signing pipeline is
correct.

Replace `BASE_URL` with your project's stable URL (for example
`https://project--<project-id>.lovable.app`) and `API_KEY` with your raw key.

### 3.1 curl (`openssl dgst`)

```bash
BASE_URL="https://project--YOUR-PROJECT-ID.lovable.app"
API_KEY="gm_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

BODY='{"probe":"hello"}'
TS=$(date -u +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" \
  | openssl dgst -sha256 -hmac "$API_KEY" \
  | awk '{print $2}')

curl -sS -X POST "$BASE_URL/api/public/hooks/ping" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-timestamp: $TS" \
  -H "x-signature: sha256=$SIG" \
  --data-binary "$BODY"
```

Expected response:

```json
{ "pong": true, "caller": "api_key", "companyId": "…" }
```

### 3.2 Node 20+ / TypeScript (`node:crypto`)

```ts
import { createHmac } from "node:crypto";

const BASE_URL = "https://project--YOUR-PROJECT-ID.lovable.app";
const API_KEY = process.env.GRIDMIND_API_KEY!;

async function ping() {
  const body = JSON.stringify({ probe: "hello" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", API_KEY)
    .update(`${ts}.${body}`)
    .digest("hex");

  const res = await fetch(`${BASE_URL}/api/public/hooks/ping`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${API_KEY}`,
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": `sha256=${sig}`,
    },
    body, // exact bytes we signed — do not re-serialize
  });
  console.log(res.status, await res.text());
}

ping();
```

### 3.3 Python 3.11+ (`hmac` + `urllib`)

```python
import hmac, hashlib, json, os, time, urllib.request

BASE_URL = "https://project--YOUR-PROJECT-ID.lovable.app"
API_KEY = os.environ["GRIDMIND_API_KEY"]

body = json.dumps({"probe": "hello"}, separators=(",", ":")).encode("utf-8")
ts = str(int(time.time()))
sig = hmac.new(API_KEY.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()

req = urllib.request.Request(
    f"{BASE_URL}/api/public/hooks/ping",
    data=body,  # exact bytes we signed
    method="POST",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "x-timestamp": ts,
        "x-signature": f"sha256={sig}",
    },
)
with urllib.request.urlopen(req) as resp:
    print(resp.status, resp.read().decode())
```

---

## 4. Handling 429 rate limits

When you exceed the token bucket for an endpoint+key you receive:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 3
Content-Type: application/json

{ "error": "rate_limited" }
```

Guidelines:

1. **Honor `Retry-After`.** Sleep at least that many seconds before retrying.
2. **Exponential backoff with jitter** for repeated failures — e.g.
   `min(cap, base * 2^attempt) + random(0, base)` — so multiple retrying
   workers don't converge on the same instant.
3. **Batch** where possible. `/api/public/hooks/scada-telemetry` accepts up
   to 1,000 readings in a single POST; one signed batch beats a thousand
   signed singletons.
4. **Never mutate the body between signing and sending.** If a retry
   framework re-serializes the payload (adds whitespace, reorders keys), the
   next attempt will fail with `signature_invalid` even though your key is
   valid. Sign inside the code path that actually issues the request, and
   keep the raw bytes.

---

## 5. Error catalog (quick reference)

| Code                 | HTTP | Meaning                                                  |
| -------------------- | ---- | -------------------------------------------------------- |
| `unauthorized`       | 401  | Missing/invalid/revoked Bearer key.                      |
| `insufficient_scope` | 403  | Key lacks the required scope.                            |
| `ip_not_allowed`     | 403  | Caller IP not in the key's allowlist (enforced mode).    |
| `signature_expired`  | 401  | `x-timestamp` outside the 300 s replay window.           |
| `signature_invalid`  | 401  | HMAC mismatch — usually re-serialized body.              |
| `rate_limited`       | 429  | Bucket empty — honor `Retry-After`.                      |
| `invalid_payload`    | 400  | Body failed schema validation.                           |

---

## 6. Where to go next

- **SCADA integrators** — same signing recipe, POST batches to
  `/api/public/hooks/scada-telemetry` with the `scada:telemetry:write` scope.
- **Outbound webhook consumers** — GridMind signs deliveries symmetrically
  with `x-gridmind-timestamp` / `x-gridmind-signature`. Verify with the
  endpoint secret shown once in **Settings → Webhooks**.
- **In-app reference** — `/docs/api` inside the app renders the live scope
  catalog and endpoint table.
