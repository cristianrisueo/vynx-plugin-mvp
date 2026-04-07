import { z } from "zod";

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
