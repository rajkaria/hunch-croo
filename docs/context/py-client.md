---
feature: Python SDK — hunch-cap-client (S14)
globs:
  - packages/py-client/**
  - docs/PY-CLIENT.md
  - .github/workflows/ci.yml
updated: 2026-07-06
---

# Python SDK — hunch-cap-client (S14)

A zero-dependency (stdlib only) Python port of `packages/client`
(`@hunchxyz/cap-client`), over the identical CAP REST surface.

## Current state — what's working

- **Green + shipped** on branch `claude/reverent-shirley-ac533f` (commit `d012e2d`,
  hardened by review commit `8301834`). 14 tests pass.
- Standalone package `packages/py-client/` — NOT in the pnpm workspace (no
  package.json), so `pnpm gate` is unchanged. Layout: `hunch_cap_client/{__init__,
  _client}.py` + `py.typed`, `pyproject.toml` (PEP 621, hatchling, `requires-python
  >=3.8`, zero deps), `README.md`, `LICENSE`, `examples/hire_forecast.py`,
  `tests/test_client.py` (+ `tests/__init__.py`).
- `CapClient` mirrors the TS client: `negotiate`, `list_requester_orders`,
  `pay_order`, `get_delivery`, and one-call `hire()`. Same base
  (`{api_url}/backend/v1`), `X-SDK-Key` header, `negotiationId`/`negotiation_id`
  fallback, and `CapError` parity message. Injectable `transport` + `sleep`/`now`
  → the suite runs offline via `ScriptedTransport` + `FakeClock`.
- Tests use stdlib `unittest` (no pip install): `python -m unittest discover -s
  packages/py-client/tests -t packages/py-client`. Runs as its own CI job
  `py-client` in `.github/workflows/ci.yml` (setup-python 3.12).

## Key decisions

- Sync + zero-dep (stdlib `urllib`) to match the TS client's ethos; no async
  client (stdlib async HTTP not worth the sharp edges).
- `unittest` over `pytest` so tests run anywhere with no install.
- **Review fidelity fixes (commit `8301834`):** delivery poll now catches any
  Exception (incl. a non-JSON 2xx blip) to mirror TS `.catch(()=>null)` — was
  crashing on `JSONDecodeError`; deliverable selection uses nullish (not falsy)
  semantics so an empty `deliverableText` matches TS `??`.

## Next steps (optional)

- Publish to PyPI (packaging is ready; release is a manual step — not done).
