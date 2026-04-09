/**
 * simulate_agent.ts
 *
 * Grant Reviewer E2E Simulation: Initialises the AgentKit runtime with CDP
 * MPC credentials on Base Sepolia, injects the VynxActionProvider, and
 * autonomously signs an EIP-712 intent for a cross-chain transfer.
 */

import "reflect-metadata";
import { AgentKit, CdpEvmWalletProvider } from "@coinbase/agentkit";
import {
  VynxActionProvider,
  VynxTransferSchema,
} from "../src/providers/crosschainTransfer.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const RELAYER_URL = process.env.VYNX_RELAYER_URL ?? "http://localhost:8080";

// 10 USDC at 6 decimals, expressed in base units (wei equivalent)
const AMOUNT_IN = "10000000";
const MIN_AMOUNT_OUT = "9900000"; // 1 % max slippage

// USDC Base Sepolia -> Arbitrum One
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const DEST_CHAIN_ID = 42161;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    "=================================================================",
  );
  console.log("  VynX AgentKit Plugin — Institutional E2E Simulation");
  console.log("  Powered by Coinbase CDP MPC Wallets & Base L2");
  console.log(
    "=================================================================",
  );
  console.log(`  Relayer URL: ${RELAYER_URL}`);
  console.log();

  // Override VYNX_RELAYER_URL so the provider picks up the Docker-networked instance.
  process.env.VYNX_RELAYER_URL = RELAYER_URL;

  // 1. Initialise AgentKit & CDP MPC Wallet
  console.log("  [1/4] Provisioning CDP MPC Wallet on Base Sepolia...");

  let walletProvider: CdpEvmWalletProvider;
  try {
    // Sanitize CDP credentials: Docker env_file injects multi-line PEM values as
    // raw strings with literal \n sequences and surrounding double-quotes instead
    // of actual newlines. The SDK does not sanitize env vars automatically, so we
    // must do it before passing them in explicitly.
    const sanitizedKeyId = (
      process.env.CDP_API_KEY_NAME || process.env.CDP_API_KEY_ID || ""
    ).replace(/^"|"$/g, "").trim();

    // Prefer CDP_API_KEY_SECRET (PKCS8 PEM) over CDP_API_KEY_PRIVATE_KEY (SEC1 PEM).
    // The SDK's JWT layer requires PKCS8 format; SEC1 fails importPKCS8 validation.
    const sanitizedKeySecret = (
      process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY || ""
    )
      .replace(/^"|"$/g, "")
      .replace(/\\n/g, "\n")
      .trim();

    const sanitizedWalletSecret = (process.env.CDP_WALLET_SECRET || "")
      .replace(/^"|"$/g, "")
      .trim();

    walletProvider = await CdpEvmWalletProvider.configureWithWallet({
      apiKeyId:     sanitizedKeyId,
      apiKeySecret: sanitizedKeySecret,
      walletSecret: sanitizedWalletSecret,
      networkId:    "base-sepolia",
    });

    await AgentKit.from({ walletProvider });
  } catch (error) {
    console.error(
      "  FAIL: Could not initialize AgentKit/CDP Wallet. Check your CDP API Keys in .env",
    );
    console.error(error);
    process.exit(1);
  }
  const network = walletProvider.getNetwork();

  console.log("  Wallet Address :", walletProvider.getAddress());
  console.log("  Network ID     :", network.networkId);
  console.log("  MPC Provisioning -> SUCCESS ✓\n");

  // 2. Instantiate VynxActionProvider
  console.log("  [2/4] Initialising VynX Settlement Action Provider...");
  const provider = new VynxActionProvider();

  const supported = provider.supportsNetwork(network);
  if (!supported) {
    console.error(
      `  FAIL: network '${network.networkId}' is not supported by VynX yet.`,
    );
    process.exit(1);
  }
  console.log("  Action Provider Guard -> PASS ✓\n");

  // 3. Parse raw arguments through VynxTransferSchema (Zero-Precision-Loss validation)
  console.log("  [3/4] Validating intent parameters (Zod Schema)...");
  const parseResult = VynxTransferSchema.safeParse({
    destChainId: DEST_CHAIN_ID,
    srcToken: USDC_BASE_SEPOLIA,
    destToken: USDC_ARBITRUM,
    amountIn: AMOUNT_IN,
    minAmountOut: MIN_AMOUNT_OUT,
  });

  if (!parseResult.success) {
    console.error(
      "  FAIL: Schema validation error:",
      parseResult.error.format(),
    );
    process.exit(1);
  }
  const args = parseResult.data;

  console.log(`    srcToken    : ${args.srcToken}`);
  console.log(`    destChainId : ${args.destChainId} (Arbitrum One)`);
  console.log("  Schema Validation -> PASS ✓\n");

  // 4. Invoke the action directly passing the unified walletProvider
  console.log(
    "  [4/4] Executing EIP-712 Signature & Dispatching to Relayer...",
  );

  try {
    const result = await provider.executeTransfer(walletProvider, args);

    console.log(
      "\n  ── Settlement Engine Result ─────────────────────────────────",
    );
    console.log(" ", result);
    console.log(
      "  ─────────────────────────────────────────────────────────────\n",
    );

    // 5. Classify outcome
    if (result.includes("successfully") || result.includes("0x")) {
      console.log("  STATUS: PASS — HFT Intent Captured by Relayer ✓");
      process.exit(0);
    } else {
      console.error(
        "  STATUS: FAIL — Relayer exception or signature rejection",
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(
      "  STATUS: FAIL — Execution reverted during provider delegation.",
    );
    console.error(error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled simulation error:", err);
  process.exit(1);
});
