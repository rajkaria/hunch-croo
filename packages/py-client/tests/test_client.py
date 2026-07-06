"""Offline tests for the CAP Python client — stdlib unittest, no network, no
credentials, no third-party deps. A scripted transport plays back per-endpoint
responses and a fake clock makes the poll loop instant and deterministic.

Run:  python -m unittest discover -s packages/py-client/tests -t packages/py-client
"""

import json
import unittest

from hunch_cap_client import CapClient, CapError, HttpResponse


class ScriptedTransport:
    """Records requests and returns queued responses per route (last repeats)."""

    def __init__(self, responses):
        self.responses = {k: list(v) for k, v in responses.items()}
        self.cursors = {}
        self.requests = []

    @staticmethod
    def _route(method, path):
        if path.startswith("/orders/negotiate"):
            return f"{method} /orders/negotiate"
        if "/pay" in path:
            return f"{method} /orders/pay"
        if "/delivery" in path:
            return f"{method} /orders/delivery"
        if path.startswith("/orders"):
            return f"{method} /orders"
        return f"{method} {path}"

    def __call__(self, method, url, headers, body):
        path = url.split("/backend/v1", 1)[1]
        self.requests.append(
            {"method": method, "path": path, "headers": dict(headers), "body": body}
        )
        key = self._route(method, path)
        queue = self.responses.get(key)
        if not queue:
            return HttpResponse(500, json.dumps({"error": f"no script for {key}"}))
        idx = min(self.cursors.get(key, 0), len(queue) - 1)
        self.cursors[key] = self.cursors.get(key, 0) + 1
        status, payload = queue[idx]
        text = payload if isinstance(payload, str) else json.dumps(payload)
        return HttpResponse(status, text)


class FakeClock:
    """Monotonic clock that advances only when the client sleeps."""

    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds


def make_client(transport, **kwargs):
    clock = FakeClock()
    client = CapClient(
        sdk_key="croo_sk_test",
        api_url="https://api.croo.network",
        transport=transport,
        sleep=clock.sleep,
        now=clock.now,
        **kwargs,
    )
    return client, clock


ACCEPTED_ORDER = {"orderId": "ord-1", "negotiationId": "neg-1", "status": "created"}
FINAL_ORDER = {
    "orderId": "ord-1",
    "negotiationId": "neg-1",
    "status": "completed",
    "createTxHash": "0xc",
    "payTxHash": "0xp",
    "deliverTxHash": "0xd",
    "clearTxHash": "0xcl",
}


class HireHappyPathTest(unittest.TestCase):
    def test_full_flow(self):
        transport = ScriptedTransport(
            {
                "POST /orders/negotiate": [(200, {"negotiationId": "neg-1"})],
                "GET /orders": [
                    (200, {"orders": []}),  # 1st poll: not accepted
                    (200, {"orders": [ACCEPTED_ORDER]}),  # 2nd poll: accepted
                    (200, {"orders": [FINAL_ORDER]}),  # final read for tx hashes
                ],
                "POST /orders/pay": [(200, "")],
                "GET /orders/delivery": [
                    (200, {}),  # not delivered yet
                    (200, {"deliverableText": json.dumps({"probability": 0.5})}),
                ],
            }
        )
        client, _ = make_client(transport)
        result = client.hire("svc-forecast", {"question": "up?"}, poll_s=5, timeout_s=600)

        self.assertEqual(result.order_id, "ord-1")
        self.assertEqual(result.negotiation_id, "neg-1")
        self.assertEqual(result.deliverable, {"probability": 0.5})
        self.assertEqual(
            result.tx_hashes,
            {"create": "0xc", "pay": "0xp", "deliver": "0xd", "clear": "0xcl"},
        )
        # it paid the created order exactly once
        pays = [r for r in transport.requests if r["path"].endswith("/pay")]
        self.assertEqual(len(pays), 1)

    def test_skips_pay_when_order_already_paid(self):
        paid_order = {**ACCEPTED_ORDER, "status": "paid"}
        transport = ScriptedTransport(
            {
                "POST /orders/negotiate": [(200, {"negotiationId": "neg-1"})],
                "GET /orders": [(200, {"orders": [paid_order]}), (200, {"orders": [FINAL_ORDER]})],
                "GET /orders/delivery": [(200, {"deliverableText": "{}"})],
            }
        )
        client, _ = make_client(transport)
        client.hire("svc-forecast", {"q": 1}, poll_s=5)
        pays = [r for r in transport.requests if r["path"].endswith("/pay")]
        self.assertEqual(pays, [])

    def test_non_json_delivery_returned_as_text(self):
        transport = ScriptedTransport(
            {
                "POST /orders/negotiate": [(200, {"negotiationId": "neg-1"})],
                "GET /orders": [(200, {"orders": [ACCEPTED_ORDER]}), (200, {"orders": [FINAL_ORDER]})],
                "POST /orders/pay": [(200, "")],
                "GET /orders/delivery": [(200, {"deliverableText": "not json {{"})],
            }
        )
        client, _ = make_client(transport)
        result = client.hire("svc", {}, poll_s=5)
        self.assertEqual(result.deliverable, "not json {{")

    def test_non_json_2xx_delivery_blip_keeps_polling(self):
        # A transient 2xx with a non-JSON body must NOT crash hire() — the TS
        # client swallows it and keeps polling. Here the 1st delivery read is an
        # HTML blip (json.loads raises); the 2nd is the real deliverable.
        transport = ScriptedTransport(
            {
                "POST /orders/negotiate": [(200, {"negotiationId": "neg-1"})],
                "GET /orders": [(200, {"orders": [ACCEPTED_ORDER]}), (200, {"orders": [FINAL_ORDER]})],
                "POST /orders/pay": [(200, "")],
                "GET /orders/delivery": [
                    (200, "<html>gateway blip</html>"),  # 2xx, not JSON
                    (200, {"deliverableText": json.dumps({"ok": True})}),
                ],
            }
        )
        client, _ = make_client(transport)
        result = client.hire("svc", {}, poll_s=5)
        self.assertEqual(result.deliverable, {"ok": True})

    def test_empty_text_with_schema_matches_ts_nullish_selection(self):
        # {deliverableText: "", deliverableSchema: "SCHEMA"} → TS keeps the empty
        # string (?? is nullish), so deliverable is "". Python must match (not
        # fall through to the schema on the falsy empty string).
        transport = ScriptedTransport(
            {
                "POST /orders/negotiate": [(200, {"negotiationId": "neg-1"})],
                "GET /orders": [(200, {"orders": [ACCEPTED_ORDER]}), (200, {"orders": [FINAL_ORDER]})],
                "POST /orders/pay": [(200, "")],
                "GET /orders/delivery": [
                    (200, {"deliverableText": "", "deliverableSchema": "SCHEMA"}),
                ],
            }
        )
        client, _ = make_client(transport)
        result = client.hire("svc", {}, poll_s=5)
        self.assertEqual(result.deliverable, "")


class NegotiateTest(unittest.TestCase):
    def test_snake_case_negotiation_id_fallback(self):
        transport = ScriptedTransport(
            {"POST /orders/negotiate": [(200, {"negotiation_id": "neg-snake"})]}
        )
        client, _ = make_client(transport)
        self.assertEqual(client.negotiate("svc", {"q": 1}), "neg-snake")

    def test_missing_negotiation_id_raises(self):
        transport = ScriptedTransport({"POST /orders/negotiate": [(200, {})]})
        client, _ = make_client(transport)
        with self.assertRaises(CapError):
            client.negotiate("svc", {"q": 1})

    def test_dict_requirements_are_json_serialized(self):
        transport = ScriptedTransport(
            {"POST /orders/negotiate": [(200, {"negotiationId": "n"})]}
        )
        client, _ = make_client(transport)
        client.negotiate("svc-x", {"question": "up?"})
        body = json.loads(transport.requests[0]["body"].decode("utf-8"))
        self.assertEqual(body["service_id"], "svc-x")
        self.assertEqual(json.loads(body["requirements"]), {"question": "up?"})

    def test_string_requirements_pass_through_unchanged(self):
        transport = ScriptedTransport(
            {"POST /orders/negotiate": [(200, {"negotiationId": "n"})]}
        )
        client, _ = make_client(transport)
        client.negotiate("svc-x", '{"already":"json"}')
        body = json.loads(transport.requests[0]["body"].decode("utf-8"))
        self.assertEqual(body["requirements"], '{"already":"json"}')


class ErrorTest(unittest.TestCase):
    def test_non_2xx_raises_cap_error_with_status(self):
        transport = ScriptedTransport(
            {"POST /orders/negotiate": [(400, {"error": "bad service"})]}
        )
        client, _ = make_client(transport)
        with self.assertRaises(CapError) as ctx:
            client.negotiate("svc", {"q": 1})
        self.assertEqual(ctx.exception.status, 400)
        self.assertIn("400", str(ctx.exception))

    def test_sdk_key_never_appears_in_error_message(self):
        transport = ScriptedTransport(
            {"POST /orders/negotiate": [(401, "unauthorized")]}
        )
        client, _ = make_client(transport)
        with self.assertRaises(CapError) as ctx:
            client.negotiate("svc", {"q": 1})
        self.assertNotIn("croo_sk_test", str(ctx.exception))

    def test_headers_carry_sdk_key(self):
        transport = ScriptedTransport(
            {"POST /orders/negotiate": [(200, {"negotiationId": "n"})]}
        )
        client, _ = make_client(transport)
        client.negotiate("svc", {"q": 1})
        self.assertEqual(transport.requests[0]["headers"]["X-SDK-Key"], "croo_sk_test")


class TimeoutTest(unittest.TestCase):
    def test_timeout_waiting_for_acceptance(self):
        transport = ScriptedTransport(
            {
                "POST /orders/negotiate": [(200, {"negotiationId": "neg-1"})],
                "GET /orders": [(200, {"orders": []})],  # never accepted
            }
        )
        client, _ = make_client(transport)
        with self.assertRaises(CapError) as ctx:
            client.hire("svc", {}, poll_s=5, timeout_s=30)
        self.assertIn("accept", str(ctx.exception))

    def test_timeout_waiting_for_delivery(self):
        transport = ScriptedTransport(
            {
                "POST /orders/negotiate": [(200, {"negotiationId": "neg-1"})],
                "GET /orders": [(200, {"orders": [ACCEPTED_ORDER]})],
                "POST /orders/pay": [(200, "")],
                "GET /orders/delivery": [(200, {})],  # never delivered
            }
        )
        client, _ = make_client(transport)
        with self.assertRaises(CapError) as ctx:
            client.hire("svc", {}, poll_s=5, timeout_s=30)
        self.assertIn("delivery", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
