"""Hire the Hunch Oracle Desk for a forecast — the Python twin of the Node
spike-requester. Reads CROO_SDK_KEY from the env, hires the forecast service,
and prints the deterministic deliverable + its on-chain settlement tx.

    export CROO_SDK_KEY=croo_sk_...
    export FORECAST_SERVICE_ID=<forecast service id from the Agent Store>
    python packages/py-client/examples/hire_forecast.py
"""

import os
import sys

from hunch_cap_client import CapClient, CapError


def main() -> int:
    sdk_key = os.environ.get("CROO_SDK_KEY")
    service_id = os.environ.get("FORECAST_SERVICE_ID")
    if not sdk_key or not service_id:
        print("set CROO_SDK_KEY and FORECAST_SERVICE_ID", file=sys.stderr)
        return 2

    client = CapClient(sdk_key=sdk_key)
    try:
        result = client.hire(
            service_id=service_id,
            requirements={
                "question": "Will $AIXBT reach $50M market cap by July 15, 2026?"
            },
        )
    except CapError as error:
        print(f"hire failed: {error}", file=sys.stderr)
        return 1

    print("deliverable:", result.deliverable)
    print("settlement tx (Base):", result.tx_hashes.get("clear", "—"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
