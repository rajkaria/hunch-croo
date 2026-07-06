# S14 — Python SDK ("hire the desk from Python")

**Status:** approved design · **Date:** 2026-07-06 · **Sprint:** S14

Final sprint of the S11→S14 roadmap (track-record → observability → portfolio
hedge → **Python SDK**). S6 shipped `@hunchxyz/cap-client` so any *Node* agent
can hire the desk in ~20 lines. S14 gives the *Python* agent ecosystem the same
thing: a zero-dependency, faithful port over the identical CAP REST surface.

## The problem it kills

Most of the AI-agent ecosystem is Python (LangChain, CrewAI, autogen, raw
`asyncio` bots). Today they'd have to hand-roll the CAP hire flow against the
REST docs. S14 ports the proven TS client one-to-one: `negotiate → wait for
accept → pay (USDC escrow on Base) → poll delivery → parse`, so a Python agent
hires any CAP service — forecast, verify, spawn, hedge-quote, **portfolio-hedge**
— in the same handful of lines.

## Scope

In scope:
- A new **standalone Python package** `packages/py-client/` (`hunch-cap-client`
  on PyPI), **zero third-party dependencies** (stdlib `urllib` only) — mirroring
  the TS client's dependency-free ethos and maximal portability.
- A synchronous `CapClient` with the same method surface and semantics as the TS
  client: `negotiate`, `list_requester_orders`, `pay_order`, `get_delivery`,
  and the one-call `hire(...)`.
- An **injectable transport** (like the TS client's `fetch_impl`) so the whole
  suite tests offline, deterministic, credential- and network-free.
- Tests in **stdlib `unittest`** (no `pytest` install needed → runnable anywhere
  Python 3.8+ is), driving the full hire flow against a scripted fake.
- `pyproject.toml` (PEP 621), `README.md` mirroring the TS client's, `LICENSE`
  (MIT), `py.typed`, a runnable `examples/hire_forecast.py`, and a CI job.

Out of scope: an async client (stdlib-only async HTTP is not worth the sharp
edges; sync mirrors the TS client and is trivially wrappable in a thread);
publishing to PyPI (packaging is ready; the release is a manual step); re-porting
provider-side logic (the SDK is requester-side only, exactly like the TS one).

## Architecture

The package is intentionally *not* in the pnpm workspace (it has no
`package.json`); `pnpm gate` is unchanged. Python is validated by its own
`unittest` run and a dedicated CI job, so the repo keeps one honest "everything
is tested" story across two languages.

```
packages/py-client/
  pyproject.toml
  README.md
  LICENSE
  hunch_cap_client/
    __init__.py         # re-exports CapClient, HireResult, CapError, __version__
    _client.py          # the implementation
    py.typed
  examples/
    hire_forecast.py
  tests/
    test_client.py      # unittest, offline via injected transport
```

### The client — `hunch_cap_client/_client.py`

Faithful port of `packages/client/src/index.ts`. Same base
(`{apiUrl}/backend/v1`), same `X-SDK-Key` header, same endpoints and field
fallbacks (`negotiationId` / `negotiation_id`).

```python
Transport = Callable[[str, str, Mapping[str, str], Optional[bytes]], "HttpResponse"]
#            (method,  url,  headers,                body) -> response

@dataclass
class HttpResponse:
    status: int
    text: str

@dataclass
class HireResult:
    order_id: str
    negotiation_id: str
    deliverable: Any           # parsed JSON, or raw str when not JSON
    raw: Dict[str, Optional[str]]
    tx_hashes: Dict[str, str]  # create/pay/deliver/clear when present

class CapError(RuntimeError):
    def __init__(self, message: str, status: int | None = None): ...

class CapClient:
    def __init__(self, sdk_key: str, api_url: str = "https://api.croo.network",
                 transport: Optional[Transport] = None,
                 sleep: Callable[[float], None] = time.sleep,
                 now: Callable[[], float] = time.monotonic) -> None: ...

    def negotiate(self, service_id: str, requirements: Any) -> str: ...        # -> negotiation_id
    def list_requester_orders(self, status: str | None = None) -> list[dict]: ...
    def pay_order(self, order_id: str) -> None: ...
    def get_delivery(self, order_id: str) -> dict: ...
    def hire(self, service_id: str, requirements: Any, *,
             timeout_s: float = 600.0, poll_s: float = 5.0) -> HireResult: ...
```

- `requirements` serialized exactly like TS: a `str` is passed through, anything
  else is `json.dumps`-ed.
- Non-2xx → `CapError` with `"CAP {method} {path} → {status}: {body[:300]}"`
  (parity with the TS thrown message), carrying `.status`.
- `hire()` replicates the TS state machine precisely: negotiate → poll
  `list_requester_orders` until an order for our negotiation appears (or
  `timeout`), pay if `status == "created"`, poll `get_delivery` until
  `deliverableText`/`deliverableSchema` present, parse JSON (fallback raw),
  collect the four tx hashes from the final order row. Deadlines use the injected
  `now`/`sleep` so tests are instant and deterministic.
- Default transport wraps `urllib.request` (stdlib): builds the `Request`, sets
  headers, reads status + body, maps `HTTPError` to an `HttpResponse` (so the
  non-2xx path is uniform, matching how TS reads `response.ok` then the text).

### `__init__.py`

Re-exports `CapClient`, `HireResult`, `HttpResponse`, `CapError`, `Transport`,
and `__version__ = "0.1.0"` (kept in lockstep with the TS client's version).

### Packaging — `pyproject.toml`

PEP 621, `hatchling` build backend, `requires-python = ">=3.8"`, MIT, no runtime
deps, `[project.optional-dependencies].dev = ["pytest"]` (optional — the suite
also runs under `python -m unittest`), keywords + repo metadata mirroring the TS
package. `py.typed` shipped for downstream type checkers.

### README + example

`README.md` mirrors `packages/client/README.md` beat-for-beat in Python:
`pip install hunch-cap-client`, the ~15-line hire snippet, the forecast
deliverable shape, `result.tx_hashes["clear"]`, where to get a key, link to
`/docs`. `examples/hire_forecast.py` is a runnable script (reads `CROO_SDK_KEY`
from env, hires a forecast, prints the deliverable) — the Python twin of
`spike-requester`.

### CI

`.github/workflows/*` gains a `py-client` job: `actions/setup-python`, then
`python -m unittest discover -s packages/py-client/tests -v`. No pip install
needed (stdlib-only tests). Runs alongside the existing Node `pnpm gate` job.

> **Back-reference (S13):** the example + README call out that the same client
> hires the S13 `portfolio-hedge` service (pass a `positions` list as
> `requirements`) — one SDK, every service on the desk.

## Honesty & safety invariants

- **Zero runtime dependencies** — auditable, supply-chain-clean, install-anywhere
  (mirrors the TS client and the repo's ethos).
- **Faithful port** — identical endpoints/headers/semantics to the audited TS
  client; no behavioural drift between the two SDKs.
- **Offline, deterministic tests** — injected transport + injected clock; no
  network, no credentials, no flakiness (matches the repo's mock-first suite).
- **Requester-side only** — the SDK moves the caller's own USDC to escrow via
  CAP; it never touches the desk's keys or funds.

## Testing (stdlib `unittest`, offline)

`tests/test_client.py` drives a `ScriptedTransport` (records requests, returns
queued responses):
- `negotiate` posts the right body, returns the id, honours the
  `negotiation_id` snake-case fallback.
- `hire` happy path: negotiate → order appears on the 2nd poll → pays a
  `created` order → delivery arrives → parses JSON → collects tx hashes.
- `hire` skips pay when the order is already `paid`/`completed`.
- delivery that isn't JSON is returned as the raw string.
- `timeout_s` exceeded waiting for accept → `CapError`; waiting for delivery →
  `CapError`.
- non-2xx → `CapError` with status + parity message.
- `requirements` dict is `json.dumps`-ed; a `str` passes through unchanged.
- request headers carry `X-SDK-Key`; the SDK key never appears in an error
  message (parity with the desk's redaction ethos).

## File manifest

New:
- `packages/py-client/pyproject.toml`
- `packages/py-client/README.md`
- `packages/py-client/LICENSE`
- `packages/py-client/hunch_cap_client/{__init__,_client}.py`
- `packages/py-client/hunch_cap_client/py.typed`
- `packages/py-client/examples/hire_forecast.py`
- `packages/py-client/tests/test_client.py`
- `docs/PY-CLIENT.md`

Modified:
- `.github/workflows/<ci>.yml` (Python `unittest` job)
- `README.md` (Python client section alongside the Node one)
