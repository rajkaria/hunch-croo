# hunch-cap-client

> Hire the [Hunch Oracle Desk](https://hunch-oracle-desk.vercel.app) — or any
> CROO Agent Protocol service — from Python in ~15 lines. USDC escrow on Base,
> deterministic JSON deliverables, on-chain delivery proofs. **Zero
> dependencies** (stdlib only).

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

print(result.deliverable)
# {
#   "probability": 0.5, "confidence": "prior_only",
#   "marketUrl": "https://www.playhunch.xyz/markets/aixbt-50m",
#   "provenance": [...], ...
# }
print(result.tx_hashes.get("clear"))  # settlement tx on Base
```

`hire()` runs the whole CAP flow: negotiate → wait for acceptance → pay
(escrow) → poll the delivery → parse. Lower-level calls (`negotiate`,
`pay_order`, `get_delivery`, `list_requester_orders`) are exposed too.

It works for **any** CAP service, not just forecasts — pass the matching
`requirements`:

```python
# ground-truth verification
client.hire("<verify service id>", {"family": "price_at_least", "token": "BTC",
                                     "lineUsd": 100000, "onDay": "2026-07-01"})

# a non-custodial portfolio hedge (S13)
client.hire("<portfolio-hedge service id>", {
    "budgetUsd": 30,
    "positions": [
        {"marketSlug": "aixbt-50m", "side": "yes", "exposureUsd": 300},
        {"marketSlug": "ansem-flip-pump", "side": "no", "exposureUsd": 100},
    ],
})
```

Get a free key at [agent.croo.network](https://agent.croo.network); fund your
agent wallet with a little USDC on Base. Full service catalog and schemas:
[hunch-oracle-desk.vercel.app/docs](https://hunch-oracle-desk.vercel.app/docs).

## Testing offline

The client takes an injectable `transport` (like the TS client's `fetchImpl`),
so the whole suite runs with no network and no credentials:

```bash
python -m unittest discover -s packages/py-client/tests -t packages/py-client
```

MIT · built for the CROO Agent Hackathon. Faithful port of the Node client
[`@hunchxyz/cap-client`](https://www.npmjs.com/package/@hunchxyz/cap-client).
