# VynX AgentKit Plugin

**The Machine-to-Machine Settlement Standard for the Base Ecosystem**

[![npm version](https://img.shields.io/npm/v/vynx-agentkit-plugin)](https://www.npmjs.com/package/vynx-agentkit-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/cristianrisueo/vynx-plugin-mvp/actions/workflows/ci.yml/badge.svg)](https://github.com/cristianrisueo/vynx-plugin-mvp/actions/workflows/ci.yml)

---

VynX is the institutional settlement standard for autonomous agents operating on Base. This plugin
is the canonical ingress point: a zero-dependency, zero-RPC, zero-custody TypeScript module that
elevates Coinbase AgentKit from a wallet abstraction into a full machine-to-machine (M2M)
settlement runtime. It is not a wrapper around an existing bridge — it is the reference
implementation of the M2M Settlement contract for cognitive agents.

## The Problem

Traditional DeFi bridging forces every autonomous agent to independently resolve a cascade of
protocol-level concerns before a single token can move across chains: querying liquidity pools,
estimating gas across heterogeneous fee markets, managing slippage parameters, dispatching multiple
RPC calls to origin and destination chains, and awaiting on-chain finality before confirming
success. This operational surface area is incompatible with the latency and reliability contracts
that machine-to-machine financial systems demand. Cognitive agents are forced to spend reasoning
budget on infrastructure plumbing instead of strategy.

## The Solution

VynX abstracts the entire cross-chain settlement layer behind a single typed action. When an LLM
agent issues a routing order, the `VynxActionProvider` intercepts it, validates the parameters
through a paranoid Zod schema, constructs a `VynxIntent` struct, signs it cryptographically via
EIP-712 using the agent's delegated `EvmWalletProvider`, and transmits the signed payload to the
VynX Relayer REST API — all within a single async call, without a single RPC query to any
blockchain node, in sub-200ms. The Relayer feeds the intent into a high-frequency Order Flow
Auction (OFA) engine that handles solver selection, gas abstraction, and cross-chain finality in
isolation.

The plugin's only responsibility is intent standardisation and delegated signing. Everything else
— matching, execution, finality — is the Relayer's domain. This separation is what makes the
system institutionally auditable.

## Why Base?

VynX is intentionally Base-native. Base's sub-second block times are the structural property that
makes synchronous M2M settlement possible: an agent can reason, sign, and observe finality inside
the same logical inference loop, without context-switching to a slower L1 or L2. On a chain with
12-second blocks, the cognitive loop and the settlement loop operate on incompatible time scales —
the agent must either block, poll, or speculate. On Base, they collapse into a single synchronous
flow.

Three properties of Base make this collapse possible:

- **Sub-second block production** — finality arrives within the same agent reasoning step
- **Coinbase Developer Platform integration** — institutional MPC custody is a first-class
  primitive, not a third-party add-on
- **Predictable, low fee market** — gas estimation is no longer a planning concern for the agent

Together, these properties turn Base into the only L2 where M2M settlement is a deterministic,
sub-200ms operation rather than a probabilistic, multi-second pipeline.

## Architecture

```
LLM Routing Order
      │
      ▼
┌─────────────────────────────────┐
│       VynxActionProvider        │
│  ┌──────────────────────────┐   │
│  │  VynxTransferSchema (Zod)│   │  ← strips unknown fields; transforms
│  │  paranoid validation     │   │    amounts to BigInt for EIP-712 safety
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │  EIP-712 signTypedData   │   │  ← delegated to EvmWalletProvider;
│  │  (EvmWalletProvider)     │   │    private key never leaves the SDK
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │  postIntent (fetch)      │   │  ← POST /v1/intents, 5 s timeout,
│  └──────────────────────────┘   │    never throws
└─────────────────────────────────┘
      │
      ▼
 VynX Relayer REST API
      │
      ▼
Cross-chain settlement (solver network)
```

## End-to-End Cryptographic Validation

The plugin ships a fully autonomous local simulation environment that validates the entire signing
and submission pipeline across three independent runtimes: TypeScript, Go, and Solidity.

> **Full Docker-based E2E Demo:** The complete settlement stack — Go Relayer, live CDP MPC
> wallet, and Mock Solver — is orchestrated from the monorepo root via `make reviewer-demo`.
> The root-level orchestrator is `scripts/run_workflow.ts`, which imports this plugin as a
> library and closes the loop via a WebSocket Mock Solver. The commands below describe isolated
> plugin validation only.

```bash
make e2e
```

This single command orchestrates the complete stack without any manual setup:

1. **Starts Anvil** with `--chain-id 84532` (Base Sepolia) — a deterministic local EVM node
2. **Deploys `VynxSettlement`** via Forge broadcast — the on-chain settlement contract
3. **Builds and starts the Go Relayer** — the OFA engine that verifies and processes intents
4. **Executes the TypeScript simulation** — signs a real EIP-712 payload and submits it
5. **Kills all background processes** and reports the outcome

The validation proves three independent invariants in a single run:

| Invariant | Guarantee |
|---|---|
| **Zero-Precision-Loss** | `amountIn` and `minAmountOut` are `BigInt` through the entire chain: Zod transform → EIP-712 `uint256` → Go `*big.Int` — no IEEE 754 truncation at any boundary |
| **Wire format compatibility** | The flat JSON body (`id`, `sender`, `token_in`, ...) produced by `postIntent` is accepted by Go's `json.Decoder` with `DisallowUnknownFields` — no schema divergence |
| **EIP-712 domain parity** | The `chainId` in the signing domain matches the deployed contract's chain, producing a signature that the Relayer accepts without rejection |

This guarantee was established on 2026-04-07 and is reproducible against any local Anvil instance.
For individual component validation, `make sim` runs the TypeScript layer only against a
pre-running stack.

## Quickstart

> **Grant reviewer?** The full E2E simulation — Go Relayer + CDP MPC wallet + Mock Solver —
> is a single command from the monorepo root: `make reviewer-demo`. The steps below describe
> how to consume this plugin as a library in your own AgentKit application.

### Install

```bash
npm install vynx-agentkit-plugin @coinbase/agentkit
```

### Wire into AgentKit

```typescript
import { AgentKit, CdpWalletProvider } from "@coinbase/agentkit";
import { VynxActionProvider } from "vynx-agentkit-plugin";

const walletProvider = await CdpWalletProvider.configureWithWallet({
  apiKeyName: process.env.CDP_API_KEY_NAME!,
  apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
  networkId: "base-mainnet",
});

const agentKit = await AgentKit.from({
  walletProvider,
  actionProviders: [new VynxActionProvider()],
});

// The agent now has access to the execute_vynx_crosschain_transfer tool.
```

### Configure environment

```bash
cp .env.example .env
# Fill in CDP and OpenAI credentials
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VYNX_RELAYER_URL` | No | VynX Relayer endpoint. Defaults to `https://relayer.vynx.finance`. |
| `CDP_API_KEY_NAME` | Yes* | Coinbase Developer Platform API key name. |
| `CDP_API_KEY_PRIVATE_KEY` | Yes* | CDP API private key. Never commit the real value. |
| `OPENAI_API_KEY` | Yes* | LLM provider API key for the agent runtime. |

\* Required by the AgentKit consumer application, not by this plugin directly.

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Data flow, EIP-712 design, and security model |
| [Usage Guide](docs/USAGE.md) | Initialisation, effective prompts, and schema reference |
| [Runbook](docs/RUNBOOK.md) | Make commands, CI/CD pipeline, and troubleshooting |

## License

[MIT](LICENSE) — Copyright 2026 VynX Protocol
