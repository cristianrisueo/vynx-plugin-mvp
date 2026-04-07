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
| `Submit a VynX cross-chain settlement order: route 1000000000000000000 base units of token 0xA0b8869c1Bbef9D2E2c1E3a3F71f85c9d6E57eB48 from Base to chain 42161, accept no less than 990000000000000000 base units on arrival.` | Explicit base-unit amounts prevent unit ambiguity |
| `Initiate an institutional VynX transfer: source token 0xA0b8869c1Bbef9D2E2c1E3a3F71f85c9d6E57eB48, destination chain 10, amount in 500000000, minimum amount out 495000000.` | USDC at 6 decimals; corporate phrasing |
| `Execute a delegated cross-chain settlement via VynX. Source token: 0x4200000000000000000000000000000000000006. Destination chain: 137. Amount in: 1000000000000000000. Minimum amount out: 990000000000000000.` | Structured field-by-field instruction |
| `Open a VynX intent for treasury rebalancing. Move 100000000 base units of 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 from Base to chain 42161. Minimum acceptable receipt on destination: 99000000 base units.` | Treasury-style framing |
| `Dispatch a cross-chain settlement instruction through the VynX Action Provider. Parameters — destChainId: 42161, srcToken: 0xA0b8869c1Bbef9D2E2c1E3a3F71f85c9d6E57eB48, destToken: 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8, amountIn: 1000000000000000000, minAmountOut: 980000000000000000.` | Strictly parametric form for deterministic tool selection |

> **Best practice:** Always supply token amounts in base units (wei, satoshis, or the token's
> smallest denomination) to avoid Zod validation failures caused by decimal or scientific notation
> inputs.

## Schema Reference

| Field          | Input Type | Parsed Type | Validation                              | Description                                                                                                                |
| -------------- | ---------- | ----------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `destChainId`  | `number`   | `number`    | Positive integer, max `4294967295`      | Destination chain identifier as a plain unsigned 32-bit integer (e.g. `42161` for Arbitrum One, `10` for OP Mainnet).      |
| `srcToken`     | `string`   | `string`    | `/^0x[a-fA-F0-9]{40}$/`                 | 0x-prefixed EVM contract address of the input token on the origin chain. Must be exactly 42 characters.                   |
| `destToken`    | `string`   | `string`    | `/^0x[a-fA-F0-9]{40}$/`                 | 0x-prefixed EVM contract address of the desired output token on the destination chain. Must be exactly 42 characters.     |
| `amountIn`     | `string`   | `bigint`    | `/^\d+$/`, transformed via `BigInt()`   | Exact amount to lock, expressed in base units as a decimal digit-only string. No decimal point, exponent, or sign prefix. |
| `minAmountOut` | `string`   | `bigint`    | `/^\d+$/`, transformed via `BigInt()`   | Minimum acceptable amount to receive on the destination chain, in base units. `"0"` disables slippage protection.         |

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
