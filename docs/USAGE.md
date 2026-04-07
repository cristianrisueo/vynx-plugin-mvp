# Usage Guide

## Installation

```bash
npm install vynx-agentkit-plugin @coinbase/agentkit
```

> **Note:** The package name `vynx-agentkit-plugin` reflects the local repository configuration.
> Update to the published registry name once the package is released to npm.

## Initialisation

The `VynxActionProvider` is injected into the AgentKit `actionProviders` array alongside your
chosen wallet provider. The example below uses `CdpWalletProvider`, the recommended provider for
production deployments on Base.

```typescript
import { AgentKit, CdpWalletProvider } from "@coinbase/agentkit";
import { VynxActionProvider } from "vynx-agentkit-plugin";

async function buildAgent() {
  const walletProvider = await CdpWalletProvider.configureWithWallet({
    apiKeyName: process.env.CDP_API_KEY_NAME!,
    apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    networkId: "base-mainnet",
  });

  const agentKit = await AgentKit.from({
    walletProvider,
    actionProviders: [
      new VynxActionProvider(),
      // Additional providers can be composed here.
    ],
  });

  return agentKit;
}
```

### Custom Relayer Endpoint

To direct intents to a staging or local Relayer instance, set `VYNX_RELAYER_URL` before the
process starts:

```bash
VYNX_RELAYER_URL=http://localhost:8080 node agent.js
```

## Effective LLM Prompts

The following natural-language prompts reliably trigger the `execute_vynx_crosschain_transfer`
action. Provide token addresses and amounts in base units explicitly to prevent the model from
hallucinating values.

| Prompt | Notes |
|---|---|
| `Bridge 1000000000000000000 wei of USDC (0xA0b8...eB48) from Base to Arbitrum (chain 42161), minimum output 990000000000000000 wei` | Explicit wei amounts prevent unit ambiguity |
| `Transfer 500000000 USDC (0xA0b8...eB48) to Optimism (chain 10), accept at least 495000000 on arrival` | USDC at 6 decimals |
| `Use VynX to move ETH (0x4200...0006) to Polygon (chain 137), amount 1000000000000000000 wei, slippage 1%` | Slippage expressed as a ratio is unambiguous |
| `Execute a cross-chain swap of WBTC (0x2260...c7F5) on Base to Arbitrum (42161), amount 100000000 satoshis, minimum out 99000000` | WBTC at 8 decimals |
| `Submit a VynX intent: destChainId 42161, srcToken 0xA0b8...eB48, destToken 0xFF97...0099, amountIn 1000000000000000000, minAmountOut 980000000000000000` | Structured form for deterministic triggering |

> **Best practice:** Always supply token amounts in base units (wei, satoshis, or the token's
> smallest denomination) to avoid Zod validation failures caused by decimal or scientific notation
> inputs.

## Schema Reference

| Field | Input Type | Parsed Type | Description |
|---|---|---|---|
| `destChainId` | `number` | `number` | Destination chain ID as a plain positive integer (e.g. `42161` for Arbitrum). Maximum: `4294967295`. |
| `srcToken` | `string` | `string` | 0x-prefixed EVM contract address of the input token on the origin chain. Must be exactly 42 characters. |
| `destToken` | `string` | `string` | 0x-prefixed EVM contract address of the desired output token on the destination chain. Must be exactly 42 characters. |
| `amountIn` | `string` | `bigint` | Exact amount to lock in base units as a decimal digit-only string. No decimal point, no exponent, no sign prefix. |
| `minAmountOut` | `string` | `bigint` | Minimum acceptable amount to receive on the destination chain. `"0"` disables slippage protection entirely. |

## Error Handling

The `execute_vynx_crosschain_transfer` action always returns a plain `string` to the LLM — it
never throws an exception. This design prevents the AgentKit reasoning loop from crashing on
unexpected conditions.

A successful submission returns a message containing the intent ID:

```
VynX cross-chain transfer submitted successfully. Intent ID: 0x3f2a...
```

A Relayer rejection returns a descriptive error string:

```
VynX transfer failed: Relayer rejected the intent with status 400: invalid signature
```

An unexpected runtime error returns:

```
VynX transfer encountered an unexpected error: hardware wallet disconnected
```

The consuming application can inspect the returned string for the substrings
`submitted successfully`, `transfer failed`, or `unexpected error` to determine the outcome and
decide whether to surface the message to a user, log it, or schedule a retry.
