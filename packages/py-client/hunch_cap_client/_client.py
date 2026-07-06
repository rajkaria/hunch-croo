"""hunch-cap-client — hire the Hunch Oracle Desk from Python in ~15 lines.

A zero-dependency client for CROO's Agent Protocol (CAP) REST surface, shaped
around the hire flow: negotiate -> (desk accepts) -> pay (USDC escrows on Base)
-> poll the delivery. A faithful port of the audited TypeScript client
(`@hunchxyz/cap-client`) — same endpoints, headers, and semantics. Works for ANY
CAP service, not just Hunch's.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional

__all__ = [
    "CapClient",
    "CapError",
    "HireResult",
    "HttpResponse",
    "Transport",
]


@dataclass
class HttpResponse:
    """A transport response: the HTTP status and the raw body text."""

    status: int
    text: str


# (method, url, headers, body) -> HttpResponse. Injectable so the whole client
# tests offline against a scripted fake, exactly like the TS client's fetchImpl.
Transport = Callable[[str, str, Mapping[str, str], Optional[bytes]], HttpResponse]


@dataclass
class HireResult:
    """The outcome of a completed hire: the parsed deliverable + on-chain proofs."""

    order_id: str
    negotiation_id: str
    # Parsed deliverable JSON, or the raw string when the body is not JSON.
    deliverable: Any
    raw: Dict[str, Optional[str]]
    # create / pay / deliver / clear tx hashes, when present.
    tx_hashes: Dict[str, str] = field(default_factory=dict)


class CapError(RuntimeError):
    """A CAP API error (non-2xx) or a hire-flow timeout."""

    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


def _default_transport(
    method: str, url: str, headers: Mapping[str, str], body: Optional[bytes]
) -> HttpResponse:
    """stdlib urllib transport. Maps an HTTP error to a response so the non-2xx
    path is uniform (mirrors reading `response.ok` then the text in the TS client).
    """
    request = urllib.request.Request(url, data=body, method=method)
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request) as response:  # noqa: S310 (trusted API host)
            charset = response.headers.get_content_charset() or "utf-8"
            return HttpResponse(status=response.status, text=response.read().decode(charset))
    except urllib.error.HTTPError as error:  # 4xx/5xx come back here
        raw = error.read()
        text = raw.decode("utf-8", "replace") if raw else ""
        return HttpResponse(status=error.code, text=text)


class CapClient:
    """A synchronous CAP requester client. Give it your CROO SDK key; call
    :meth:`hire` for the whole flow, or the lower-level methods individually.
    """

    def __init__(
        self,
        sdk_key: str,
        api_url: str = "https://api.croo.network",
        transport: Optional[Transport] = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._base = api_url.rstrip("/") + "/backend/v1"
        self._key = sdk_key
        self._transport = transport or _default_transport
        self._sleep = sleep
        self._now = now

    def _call(self, method: str, path: str, body: Any = None) -> Any:
        headers: Dict[str, str] = {"X-SDK-Key": self._key}
        payload: Optional[bytes] = None
        if body is not None:
            headers["content-type"] = "application/json"
            payload = json.dumps(body).encode("utf-8")
        response = self._transport(method, f"{self._base}{path}", headers, payload)
        if not (200 <= response.status < 300):
            raise CapError(
                f"CAP {method} {path} → {response.status}: {response.text[:300]}",
                status=response.status,
            )
        return json.loads(response.text) if response.text else None

    def negotiate(self, service_id: str, requirements: Any) -> str:
        """Open a negotiation for a service. Returns the negotiation id."""
        body = self._call(
            "POST",
            "/orders/negotiate",
            {
                "service_id": service_id,
                "requirements": requirements
                if isinstance(requirements, str)
                else json.dumps(requirements),
            },
        )
        negotiation_id = (body or {}).get("negotiationId") or (body or {}).get("negotiation_id")
        if not negotiation_id:
            raise CapError("negotiate returned no negotiation id")
        return negotiation_id

    def list_requester_orders(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """List orders where we are the requester (newest page)."""
        query = f"&status={status}" if status else ""
        body = self._call("GET", f"/orders?role=requester&page_size=50{query}")
        return (body or {}).get("orders", [])

    def pay_order(self, order_id: str) -> None:
        """Pay a created order — escrows USDC on Base."""
        self._call("POST", f"/orders/{order_id}/pay")

    def get_delivery(self, order_id: str) -> Dict[str, Any]:
        """Read an order's delivery (may be empty until the desk delivers)."""
        return self._call("GET", f"/orders/{order_id}/delivery") or {}

    def hire(
        self,
        service_id: str,
        requirements: Any,
        *,
        timeout_s: float = 600.0,
        poll_s: float = 5.0,
    ) -> HireResult:
        """The whole hire flow in one call: negotiate, wait for the desk to
        accept, pay (escrow on Base), poll the delivery, parse it.
        """
        deadline = self._now() + timeout_s
        negotiation_id = self.negotiate(service_id, requirements)

        # Wait for acceptance: an order appears for our negotiation.
        order: Optional[Dict[str, Any]] = None
        while order is None:
            if self._now() > deadline:
                raise CapError("timed out waiting for the provider to accept")
            self._sleep(poll_s)
            order = next(
                (o for o in self.list_requester_orders() if o.get("negotiationId") == negotiation_id),
                None,
            )

        if order.get("status") == "created":
            self.pay_order(order["orderId"])

        # Wait for the deliverable.
        while True:
            if self._now() > deadline:
                raise CapError("timed out waiting for the delivery")
            try:
                delivery = self.get_delivery(order["orderId"])
            except Exception:  # noqa: BLE001 — mirror the TS client's `.catch(() => null)`:
                # a transient blip (incl. a non-JSON 2xx body) is swallowed and
                # the poll continues to the deadline, never aborting the hire.
                delivery = {}
            delivered_text = delivery.get("deliverableText")
            delivered_schema = delivery.get("deliverableSchema")
            if delivered_text or delivered_schema:
                # Nullish selection, matching TS `deliverableText ?? deliverableSchema ?? ""`:
                # an empty string is KEPT (not skipped for the schema).
                text = (
                    delivered_text
                    if delivered_text is not None
                    else (delivered_schema if delivered_schema is not None else "")
                )
                try:
                    parsed: Any = json.loads(text)
                except (ValueError, TypeError):
                    parsed = text
                final = next(
                    (o for o in self.list_requester_orders() if o.get("orderId") == order["orderId"]),
                    {},
                )
                tx_hashes = {
                    dst: final[src]
                    for src, dst in (
                        ("createTxHash", "create"),
                        ("payTxHash", "pay"),
                        ("deliverTxHash", "deliver"),
                        ("clearTxHash", "clear"),
                    )
                    if final.get(src)
                }
                return HireResult(
                    order_id=order["orderId"],
                    negotiation_id=negotiation_id,
                    deliverable=parsed,
                    raw=delivery,
                    tx_hashes=tx_hashes,
                )
            self._sleep(poll_s)
