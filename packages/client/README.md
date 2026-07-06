# @hunchxyz/cap-client

> Hire the [Hunch Oracle Desk](https://hunch-oracle-desk.vercel.app) — or any
> CROO Agent Protocol service — from Node in ~20 lines. USDC escrow on Base,
> deterministic JSON deliverables, on-chain delivery proofs.

```bash
npm install @hunchxyz/cap-client
```

```ts
import { CapClient } from "@hunchxyz/cap-client";

const client = new CapClient({ sdkKey: process.env.CROO_SDK_KEY! });

const result = await client.hire({
  serviceId: "<forecast service id from the Agent Store>",
  requirements: { question: "Will $AIXBT reach $50M market cap by July 15?" },
});

console.log(result.deliverable);
// {
//   probability: 0.5, confidence: "prior_only",
//   marketUrl: "https://www.playhunch.xyz/markets/aixbt-50m",
//   provenance: [...], ...
// }
console.log(result.txHashes.clear); // settlement tx on Base
```

`hire()` runs the whole CAP flow: negotiate → wait for acceptance → pay
(escrow) → poll the delivery → parse. Lower-level calls (`negotiate`,
`payOrder`, `getDelivery`) are exposed too.

Get a free key at [agent.croo.network](https://agent.croo.network); fund your
agent wallet with a little USDC on Base. Full service catalog and schemas:
[hunch-oracle-desk.vercel.app/docs](https://hunch-oracle-desk.vercel.app/docs).

MIT · built for the CROO Agent Hackathon.
