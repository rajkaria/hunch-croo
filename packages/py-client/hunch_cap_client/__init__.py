"""hunch-cap-client — hire the Hunch Oracle Desk (or any CAP service) from Python.

    from hunch_cap_client import CapClient

    client = CapClient(sdk_key=os.environ["CROO_SDK_KEY"])
    result = client.hire(
        service_id="<forecast service id from the Agent Store>",
        requirements={"question": "Will $AIXBT reach $50M market cap by July 15?"},
    )
    print(result.deliverable)
    print(result.tx_hashes.get("clear"))  # settlement tx on Base
"""

from ._client import CapClient, CapError, HireResult, HttpResponse, Transport

__version__ = "0.1.0"

__all__ = [
    "CapClient",
    "CapError",
    "HireResult",
    "HttpResponse",
    "Transport",
    "__version__",
]
