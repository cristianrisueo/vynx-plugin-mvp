/**
 * simulate_agent.ts
 *
 * End-to-End simulation: initialises AgentKit with a local ViemWalletProvider
 * (Anvil Account #0), injects VynxActionProvider, and invokes
 * execute_vynx_crosschain_transfer for 10 USDC from Base Sepolia → Arbitrum One.
 *
 * Prerequisites (orchestrated by the `make e2e` target):
 *   1. Anvil running at http://127.0.0.1:8545 with --chain-id 84532
 *   2. VynxSettlement deployed (default address 0x5FbDB2315678afecb367f032d93F642f64180aa3)
 *   3. VynX Relayer running at http://127.0.0.1:8080
 *
 * Environment overrides:
 *   VYNX_RELAYER_URL  — defaults to http://127.0.0.1:8080
 *   ANVIL_RPC_URL     — defaults to http://127.0.0.1:8545
 */

import "reflect-metadata";
import { ViemWalletProvider } from "@coinbase/agentkit";
import { createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { VynxActionProvider, VynxTransferSchema } from "../src/providers/crosschainTransfer.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ANVIL_RPC_URL = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const RELAYER_URL = process.env.VYNX_RELAYER_URL ?? "http://127.0.0.1:8080";

// 10 USDC at 6 decimals, expressed in base units (wei equivalent)
const AMOUNT_IN = "10000000";
const MIN_AMOUNT_OUT = "9900000"; // 1 % max slippage

// Anvil USDC-like ERC-20 placeholder address (20-byte zero address is invalid;
// use well-known USDC Base Sepolia address for realistic EIP-712 payload)
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

// Destination: Arbitrum One
const DEST_CHAIN_ID = 42161;

// ── Local chain definition: Base Sepolia shape, Anvil backend ─────────────────
// chainId 84532 causes ViemWalletProvider to map networkId → "base-sepolia",
// satisfying VynxActionProvider.supportsNetwork().
const anvilAsSepolia = defineChain({
  id: 84532,
  name: "Anvil (Base Sepolia fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ANVIL_RPC_URL] },
  },
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=================================================================");
  console.log("  VynX AgentKit Plugin — E2E Simulation");
  console.log("=================================================================");
  console.log(`  RPC   : ${ANVIL_RPC_URL}`);
  console.log(`  Relayer: ${RELAYER_URL}`);
  console.log();

  // Override VYNX_RELAYER_URL so the provider picks up the local instance.
  process.env.VYNX_RELAYER_URL = RELAYER_URL;

  // 1. Build viem wallet client backed by Anvil Account #0
  const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: anvilAsSepolia,
    transport: http(ANVIL_RPC_URL),
  });

  // 2. Wrap in AgentKit EvmWalletProvider
  const walletProvider = new ViemWalletProvider(walletClient);

  const network = walletProvider.getNetwork();
  console.log("  Wallet  :", walletProvider.getAddress());
  console.log("  NetworkId:", network.networkId);
  console.log("  ChainId :", network.chainId);
  console.log();

  // 3. Instantiate VynxActionProvider
  const provider = new VynxActionProvider();

  console.log("  Checking supportsNetwork …");
  const supported = provider.supportsNetwork(network);
  if (!supported) {
    console.error(`  FAIL: network '${network.networkId}' is not supported.`);
    process.exit(1);
  }
  console.log("  supportsNetwork → true  ✓");
  console.log();

  // 4. Parse raw arguments through VynxTransferSchema (transforms amounts to bigint)
  const parseResult = VynxTransferSchema.safeParse({
    destChainId: DEST_CHAIN_ID,
    srcToken: USDC_BASE_SEPOLIA,
    destToken: USDC_ARBITRUM,
    amountIn: AMOUNT_IN,
    minAmountOut: MIN_AMOUNT_OUT,
  });

  if (!parseResult.success) {
    console.error("  FAIL: Schema validation error:", parseResult.error.format());
    process.exit(1);
  }
  const args = parseResult.data;

  console.log("  Intent parameters:");
  console.log(`    srcToken    : ${args.srcToken}`);
  console.log(`    destToken   : ${args.destToken}`);
  console.log(`    amountIn    : ${args.amountIn} (10 USDC @ 6 decimals)`);
  console.log(`    minAmountOut: ${args.minAmountOut}`);
  console.log(`    destChainId : ${args.destChainId} (Arbitrum One)`);
  console.log();

  // 5. Invoke the action directly (mirrors AgentKit's internal dispatch)
  console.log("  Invoking execute_vynx_crosschain_transfer …");
  const result = await provider.executeTransfer(walletProvider, args);

  console.log();
  console.log("  ── Action Result ────────────────────────────────────────────");
  console.log(" ", result);
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log();

  // 6. Classify outcome
  if (result.includes("submitted successfully")) {
    console.log("  STATUS: PASS — EIP-712 intent accepted by Relayer  ✓");
    process.exit(0);
  } else if (result.includes("transfer failed")) {
    console.error("  STATUS: FAIL — Relayer rejected the intent");
    process.exit(1);
  } else if (result.includes("unexpected error")) {
    console.error("  STATUS: ERROR — Unexpected runtime error");
    process.exit(1);
  } else {
    // e.g. supportsNetwork guard triggered (should not reach here)
    console.error("  STATUS: REJECTED — Provider guard triggered");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled simulation error:", err);
  process.exit(1);
});
