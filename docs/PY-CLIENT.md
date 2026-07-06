# Python SDK — hire the desk from Python (S14)

S6 shipped `@hunchxyz/cap-client` so any *Node* agent could hire the desk in ~20
lines. S14 gives the *Python* ecosystem — where most agent frameworks live — the
same thing: `hunch-cap-client`, a **zero-dependency** (stdlib only) client that
faithfully ports the audited TypeScript client over the identical CAP REST
surface.

## Install & hire

```bash
pip install hunch-cap-client
```

```python
import os
from hunch_cap_client import CapClient

client = CapClient(sdk_key=os.environ["CROO_SDK_KEY"])
result = client.hire(
    service_id="<forecast service id from the Agent Store>",
    requirements={"question": "Will $AIXBT reach $50M market cap by July 15?"},
)
print(result.deliverable)          # parsed JSON deliverable
print(result.tx_hashes.get("clear"))  # settlement tx on Base
```

`hire()` runs the whole flow: negotiate → wait for the desk to accept → pay
(USDC escrows on Base) → poll the delivery → parse. The lower-level methods
(`negotiate`, `list_requester_orders`, `pay_order`, `get_delivery`) are exposed
too. It works for **every** service on the desk — forecast, verify, spawn,
hedge-quote, portfolio-hedge — just pass the matching `requirements`.

## Faithful to the Node client

Same base (`{api_url}/backend/v1`), same `X-SDK-Key` header, same endpoints and
the same `negotiationId`/`negotiation_id` field fallbacks. Requirements are
serialized the same way (a `str` passes through; anything else is `json.dumps`-ed).
Errors raise `CapError` with the same `"CAP {method} {path} → {status}: …"`
message and the status attached. The two SDKs don't drift.

## Zero dependencies, offline tests

- **No third-party runtime deps** — just `urllib` from the stdlib. Auditable,
  supply-chain-clean, installs anywhere Python 3.8+ runs.
- **Injectable transport** (like the TS client's `fetchImpl`): pass
  `transport=...` and the whole client runs against a scripted fake — no network,
  no credentials. The clock (`sleep`/`now`) is injectable too, so the poll loop
  tests instantly and deterministically.

```bash
# stdlib unittest — no pip install needed
python -m unittest discover -s packages/py-client/tests -t packages/py-client
```

The suite covers the full hire state machine (accept → pay → deliver), the
already-paid skip, non-JSON deliverables, both timeout paths, the snake-case
fallback, requirement serialization, and that the SDK key never leaks into an
error message. It runs as its own CI job alongside the Node `pnpm gate`.

## Layout

```
packages/py-client/
  pyproject.toml            # PEP 621, hatchling, requires-python >=3.8, no deps
  README.md  LICENSE
  hunch_cap_client/
    __init__.py             # exports CapClient, HireResult, CapError, __version__
    _client.py              # the implementation
    py.typed                # ships types for downstream checkers
  examples/hire_forecast.py # runnable: reads CROO_SDK_KEY, hires a forecast
  tests/test_client.py      # stdlib unittest, offline
```
