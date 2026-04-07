export type HexAddress = `0x${string}`;
export type HexBytes32 = `0x${string}`;

export interface VynxIntent {
  intentId: HexBytes32; // Generated UUID/Hash
  agent: HexAddress; // Extracted from walletProvider.getAddress()
  srcChainId: number; // Extracted from walletProvider.getNetwork()
  destChainId: number; // From LLM
  srcToken: HexAddress; // From LLM
  destToken: HexAddress; // From LLM
  amountIn: string; // Stringified bigint for JSON safety
  minAmountOut: string; // Stringified bigint for JSON safety
  deadline: number; // Math.floor(Date.now() / 1000) + 300
}

export interface IntentPayload {
  intent: VynxIntent;
  signature: `0x${string}`; // Output of signTypedData
}
