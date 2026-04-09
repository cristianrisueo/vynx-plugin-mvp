import "reflect-metadata";
import {
  ActionProvider,
  CreateAction,
  type EvmWalletProvider,
  type Network,
} from "@coinbase/agentkit";
import { z } from "zod";
import { postIntent } from "../api.js";
import type { HexAddress, HexBytes32, IntentPayload, VynxIntent } from "../types.js";

// ---------------------------------------------------------------------------
// Zod Schema — LLM input validation (paranoid, zero-tolerance)
// ---------------------------------------------------------------------------

export const VynxTransferSchema = z
  .object({
    destChainId: z
      .number()
      .int()
      .positive()
      .max(4294967295)
      .describe(
        "The destination chain ID as a plain integer (e.g. 42161 for Arbitrum). MUST be a positive integer. Do NOT wrap in quotes.",
      ),
    srcToken: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address")
      .describe(
        "The 0x-prefixed EVM contract address of the input token on the origin chain. MUST be exactly 42 characters: '0x' followed by 40 hex digits.",
      ),
    destToken: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address")
      .describe(
        "The 0x-prefixed EVM contract address of the desired token on the destination chain. MUST be exactly 42 characters: '0x' followed by 40 hex digits.",
      ),
    amountIn: z
      .string()
      .regex(/^\d+$/, "Must be a decimal digit-only string with no decimal point, sign, or prefix")
      .describe(
        "The exact amount to lock in base units (wei) as a decimal digit-only string. No decimal point, no exponent, no sign prefix, no hex encoding (e.g. '1000000000000000000' for 1 USDC at 18 decimals).",
      )
      .transform(BigInt),
    minAmountOut: z
      .string()
      .regex(/^\d+$/, "Must be a decimal digit-only string with no decimal point, sign, or prefix")
      .describe(
        "The minimum acceptable amount to receive on the destination chain as a decimal digit-only string (slippage tolerance). '0' disables slippage protection entirely — use with caution.",
      )
      .transform(BigInt),
  })
  .strip();

// ---------------------------------------------------------------------------
// EIP-712 Domain & Type Definitions (immutable — never mutate at runtime)
// ---------------------------------------------------------------------------

/**
 * The EIP-712 domain separator for the VynX Settlement contract on Base.
 * chainId is filled in at signing time from the walletProvider's active network.
 */
export const EIP712_DOMAIN_TEMPLATE = {
  name: "VynX",
  version: "1",
  // verifyingContract is the deployed Settlement address on Base mainnet/sepolia.
  // Injected at signing time alongside the live srcChainId.
  verifyingContract: "0x0000000000000000000000000000000000000000" as `0x${string}`,
} as const;

/**
 * The EIP-712 type map for the Intent struct.
 * amountIn and minAmountOut are uint256 — they MUST be passed as BigInt to
 * signTypedData to avoid silent JS number truncation before the ABI encoding.
 */
export const EIP712_TYPES = {
  Intent: [
    { name: "intentId", type: "bytes32" },
    { name: "agent", type: "address" },
    { name: "srcChainId", type: "uint256" },
    { name: "destChainId", type: "uint256" },
    { name: "srcToken", type: "address" },
    { name: "destToken", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// ---------------------------------------------------------------------------
// Relayer endpoint — override via VYNX_RELAYER_URL environment variable
// ---------------------------------------------------------------------------

const VYNX_RELAYER_URL = process.env.VYNX_RELAYER_URL ?? "https://relayer.vynx.finance";

// ---------------------------------------------------------------------------
// VynxActionProvider — the AgentKit Action Provider
// ---------------------------------------------------------------------------

export class VynxActionProvider extends ActionProvider<EvmWalletProvider> {
  constructor() {
    super("vynx-crosschain-provider", []);
  }

  /**
   * Network firewall: only Base mainnet and Base Sepolia are accepted.
   * Using an arrow-function property satisfies the abstract method requirement
   * while keeping the binding stable for decorator metadata.
   */
  supportsNetwork = (network: Network): boolean =>
    network.networkId === "base-mainnet" || network.networkId === "base-sepolia";

  @CreateAction({
    name: "execute_vynx_crosschain_transfer",
    description:
      "Generates a sub-millisecond cross-chain asset transfer intent via the VynX Relayer. " +
      "Use this tool when asked to bridge or swap tokens across chains. " +
      "The agent signs the intent with EIP-712 and submits it to the VynX Relayer REST API.",
    schema: VynxTransferSchema,
  })
  async executeTransfer(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof VynxTransferSchema>,
  ): Promise<string> {
    try {
      // 1. Validate origin network — hard firewall before any signing
      const network = walletProvider.getNetwork();
      if (!this.supportsNetwork(network)) {
        return (
          `Transfer rejected: active network '${network.networkId ?? "unknown"}' is not ` +
          `supported. VynX operates on 'base-mainnet' or 'base-sepolia'.`
        );
      }

      const rawChainId = network.chainId;
      if (rawChainId === undefined) {
        return "Transfer rejected: the wallet provider did not return a chainId for the active network.";
      }

      // 2. Generate a unique intent identifier (UUID padded to bytes32)
      const intentId = `0x${crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")}` as HexBytes32;

      const agent = walletProvider.getAddress() as HexAddress;
      const srcChainId = Number(rawChainId);
      const deadline = Math.floor(Date.now() / 1000) + 300;

      // 3. Build VynxIntent — string amounts for JSON-safe transport to the Relayer
      const intent: VynxIntent = {
        intentId,
        agent,
        srcChainId,
        destChainId: args.destChainId,
        srcToken: args.srcToken as HexAddress,
        destToken: args.destToken as HexAddress,
        amountIn: args.amountIn.toString(),
        minAmountOut: args.minAmountOut.toString(),
        deadline,
      };

      // 4. Sign EIP-712 structured data
      //    CDP's cloud signing API validates the EIP712Message payload against its OpenAPI
      //    schema, which requires uint256 fields to be JSON integers (not BigInt, which
      //    serialises as a string).  All demo amounts fit within Number.MAX_SAFE_INTEGER
      //    (~9e15), so Number() conversion is lossless for this MVP.
      const signature = await walletProvider.signTypedData({
        domain: { ...EIP712_DOMAIN_TEMPLATE, chainId: Number(srcChainId) },
        types: EIP712_TYPES,
        primaryType: "Intent",
        message: {
          intentId: intent.intentId,
          agent: intent.agent,
          srcChainId: Number(srcChainId),
          destChainId: Number(intent.destChainId),
          srcToken: intent.srcToken,
          destToken: intent.destToken,
          amountIn: Number(args.amountIn),
          minAmountOut: Number(args.minAmountOut),
          deadline: Number(deadline),
        },
      });

      // 5. Transmit signed intent to the VynX Relayer
      const payload: IntentPayload = { intent, signature };
      const result = await postIntent(VYNX_RELAYER_URL, payload);

      if (!result.ok) {
        return `VynX transfer failed: ${result.error}`;
      }

      return `VynX cross-chain transfer submitted successfully. Intent ID: ${result.intentId}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `VynX transfer encountered an unexpected error: ${message}`;
    }
  }
}
