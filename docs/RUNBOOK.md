# Runbook

## Prerequisites

- Node.js >= 18 (Node 22 LTS recommended; CI runs on Node 24)
- npm >= 9
- A copy of `.env.example` populated as `.env`

```bash
cp .env.example .env
```

## Environment Setup

| Variable | Purpose | Default |
|---|---|---|
| `VYNX_RELAYER_URL` | VynX Relayer REST endpoint for intent submission | `https://relayer.vynx.finance` |
| `CDP_API_KEY_NAME` | Coinbase Developer Platform API key name | — |
| `CDP_API_KEY_PRIVATE_KEY` | CDP API private key for wallet operations | — |
| `OPENAI_API_KEY` | LLM provider API key for the agent runtime | — |

`VYNX_RELAYER_URL` is the only variable consumed directly by this plugin. The remaining three are
consumed by the AgentKit consumer application that instantiates `CdpWalletProvider`.

## Available Commands

| Command | Description |
|---|---|
| `make build` | Runs `tsc --noEmit` to type-check all source files without emitting output |
| `make test` | Runs `vitest run --coverage` and enforces 100% statement/branch/function/line coverage |
| `make lint` | Runs `biome check .` to enforce formatting and linting rules across the codebase |
| `make sim` | Compiles with `tsc` (emitDecoratorMetadata) and runs the agent simulation against a live local stack |
| `make e2e` | Full E2E orchestration: starts Anvil, deploys contract, starts Relayer, runs simulation, kills all processes |

## E2E Local Simulation

`make e2e` orchestrates three independent runtimes — TypeScript, Go, and Solidity — to validate
the full intent lifecycle: schema validation → EIP-712 signing → Go ingress → on-chain compatibility.

### Prerequisites for `make e2e`

- [Foundry](https://book.getfoundry.sh/) (`anvil`, `forge`) installed and available on `PATH`
- `../vynx-settlement-mvp` — Foundry project containing `VynxSettlement.sol`
- `../vynx-relayer-mvp` — Go module containing the OFA Relayer binary

### Expected output — successful run

```text
==> Starting Anvil (chain-id 84532) in background …
==> Deploying VynxSettlement to Anvil …

Chain 84532
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
Transactions saved to: .../broadcast/DeployVynxSettlement.s.sol/84532/run-latest.json

==> Building and starting VynX Relayer in background …
==> Running agent simulation …

=================================================================
  VynX AgentKit Plugin — E2E Simulation
=================================================================
  RPC   : http://127.0.0.1:8545
  Relayer: http://127.0.0.1:8080

  Wallet  : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  NetworkId: base-sepolia
  ChainId : 84532

  Checking supportsNetwork …
  supportsNetwork → true  ✓

  Intent parameters:
    srcToken    : 0x036CbD53842c5426634e7929541eC2318f3dCF7e
    destToken   : 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
    amountIn    : 10000000 (10 USDC @ 6 decimals)
    minAmountOut: 9900000
    destChainId : 42161 (Arbitrum One)

  Invoking execute_vynx_crosschain_transfer …

  ── Action Result ────────────────────────────────────────────
  VynX cross-chain transfer submitted successfully. Intent ID: 0x309f5a80...
  ─────────────────────────────────────────────────────────────

  STATUS: PASS — EIP-712 intent accepted by Relayer  ✓

==> Simulation exit code: 0
==> Stopping background processes …
```

### What the output proves

| Observation | Invariant confirmed |
|---|---|
| `supportsNetwork → true` | `ViemWalletProvider` with chainId 84532 maps to `networkId: base-sepolia` |
| `Invoking execute_vynx_crosschain_transfer` | `@CreateAction` decorator metadata resolved correctly via `tsc` |
| `202 Accepted` from Go Relayer | Flat JSON wire format matches Go's `DisallowUnknownFields` decoder |
| `Intent ID: 0x309f5a80...` | EIP-712 signature accepted; intent queued in the OFA auction engine |
| Exit code 0 | All three runtime boundaries (TypeScript → Go → Solidity) negotiated without error |

## Running the Test Suite

```bash
make test
```

The test suite is segregated into three isolated domains:

| Suite | File | Responsibility |
|---|---|---|
| Schema | `test/schemas/vynxTransferSchema.test.ts` | Zod validation, LLM hallucination prevention |
| API | `test/api/api.test.ts` | Network layer, Relayer error path coverage |
| Provider | `test/providers/crosschainTransfer.test.ts` | EIP-712 signing, AgentKit integration |

Coverage is enforced by `@vitest/coverage-v8`. If any metric (statements, branches, functions,
lines) drops below 100%, `make test` exits with a non-zero status code and the CI pipeline fails.

## TypeScript Compilation Check

```bash
make build
```

Runs `npx tsc --noEmit` against `src/**/*.ts` using the strict configuration in `tsconfig.json`:

| Flag | Value | Purpose |
|---|---|---|
| `strict` | `true` | Enables all strict type checks |
| `experimentalDecorators` | `true` | Required for AgentKit's `@CreateAction` decorator |
| `emitDecoratorMetadata` | `true` | Required for `reflect-metadata` integration |
| `moduleResolution` | `NodeNext` | Enforces ESM-compatible import resolution |
| `noEmit` | `true` | Validates types without writing output files |

Test files are excluded from this check. They are type-checked implicitly by Vitest's TypeScript
transformer during `make test`.

## Linting

```bash
make lint
```

Runs Biome 2.x (`@biomejs/biome`, pinned to `2.4.10`) using the configuration in `biome.json`.
Rules enforced:

- **Formatter**: 2-space indentation, 100-character line width, double quotes, trailing commas,
  semicolons always
- **Linter**: Biome recommended rule set (`lint/recommended: true`)
- **Import organisation**: imports sorted by Biome's `assist/source/organizeImports`

To apply all safe auto-fixes:

```bash
npx biome check --write .
```

To apply unsafe fixes (template literals, computed property key simplification, etc.):

```bash
npx biome check --write --unsafe .
```

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to `main`:

1. **`npm ci`** — installs exact dependency versions from `package-lock.json`
2. **`make build`** — type-checks all source files
3. **`make lint`** — enforces formatting and linting rules
4. **`make test`** — runs the full test suite and enforces 100% coverage

All three gates must pass for the pipeline to succeed. There is no deploy step in the current MVP;
the CI pipeline is a quality gate only.

## Troubleshooting

**`ReferenceError: Reflect is not defined`**

The `@CreateAction` decorator requires `reflect-metadata` to be imported before any decorated class
is instantiated. The plugin imports it at the top of `src/providers/crosschainTransfer.ts`. If you
encounter this error in a consuming application, add `import "reflect-metadata"` as the first
import in your entry point, before any AgentKit imports.

**TypeScript error: `Experimental support for decorators is a feature that is subject to change`**

Ensure your `tsconfig.json` contains both `"experimentalDecorators": true` and
`"emitDecoratorMetadata": true`. TypeScript 6 changes decorator semantics; pin your TypeScript
dependency to `"typescript": "^5.x"` to maintain compatibility with the legacy decorator API used
by AgentKit.

**Intents are being submitted to the wrong endpoint**

If `VYNX_RELAYER_URL` is not set, the plugin defaults to `https://relayer.vynx.finance`. For
local development or staging, set the variable explicitly before starting the process:

```bash
VYNX_RELAYER_URL=http://localhost:8080 node agent.js
```

**`make test` fails with a coverage threshold error**

If coverage drops below 100%, identify the uncovered lines in the HTML report generated at
`coverage/index.html` after running `make test`. Add targeted test cases for each uncovered branch
or statement and re-run. Common causes: a new guard clause added without a corresponding
failure-path test, or a new catch branch not exercised by any existing test case.
