import type { EvmWalletProvider, Network } from "@coinbase/agentkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postIntent } from "../../src/api.js";
import {
  EIP712_DOMAIN_TEMPLATE,
  EIP712_TYPES,
  VynxActionProvider,
  VynxTransferSchema,
} from "../../src/providers/crosschainTransfer.js";

// ---------------------------------------------------------------------------
// Mock the network layer — no real HTTP calls in this suite
// ---------------------------------------------------------------------------

vi.mock("../../src/api.js");

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const MOCK_ADDRESS = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";
const MOCK_SIGNATURE = "0xdeadbeefcafebabe000000000000000000000000000000000000000000000000";
const BASE_MAINNET: Network = { protocolFamily: "evm", networkId: "base-mainnet", chainId: "8453" };
const BASE_SEPOLIA: Network = {
  protocolFamily: "evm",
  networkId: "base-sepolia",
  chainId: "84532",
};
const UNSUPPORTED_NETWORK: Network = {
  protocolFamily: "evm",
  networkId: "ethereum-mainnet",
  chainId: "1",
};

const VALID_ARGS = VynxTransferSchema.parse({
  destChainId: 42161,
  srcToken: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
  destToken: "0x1234567890AbCdEf1234567890AbCdEf12345678",
  amountIn: "1000000000000000000",
  minAmountOut: "990000000000000000",
});

function makeMockWallet(overrides?: Partial<Record<string, unknown>>): EvmWalletProvider {
  return {
    getAddress: vi.fn().mockReturnValue(MOCK_ADDRESS),
    getNetwork: vi.fn().mockReturnValue(BASE_MAINNET),
    signTypedData: vi.fn().mockResolvedValue(MOCK_SIGNATURE),
    getBalance: vi.fn().mockResolvedValue(0n),
    getName: vi.fn().mockReturnValue("mock-wallet"),
    nativeTransfer: vi.fn().mockResolvedValue("0x"),
    ...overrides,
  } as unknown as EvmWalletProvider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VynxActionProvider", () => {
  let provider: VynxActionProvider;

  beforeEach(() => {
    provider = new VynxActionProvider();
    vi.mocked(postIntent).mockResolvedValue({ ok: true, intentId: "0xabc123" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // supportsNetwork
  // -------------------------------------------------------------------------

  describe("supportsNetwork", () => {
    it("returns true for base-mainnet", () => {
      expect(provider.supportsNetwork(BASE_MAINNET)).toBe(true);
    });

    it("returns true for base-sepolia", () => {
      expect(provider.supportsNetwork(BASE_SEPOLIA)).toBe(true);
    });

    it("returns false for any other network", () => {
      expect(provider.supportsNetwork(UNSUPPORTED_NETWORK)).toBe(false);
    });

    it("returns false when networkId is undefined", () => {
      expect(provider.supportsNetwork({ protocolFamily: "evm" })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // executeTransfer — network guards
  // -------------------------------------------------------------------------

  describe("executeTransfer — network validation", () => {
    it("returns an explanatory string when the network is not supported", async () => {
      const wallet = makeMockWallet({
        getNetwork: vi.fn().mockReturnValue(UNSUPPORTED_NETWORK),
      });

      const result = await provider.executeTransfer(wallet, VALID_ARGS);

      expect(typeof result).toBe("string");
      expect(result).toContain("not supported");
      expect(result).toContain("ethereum-mainnet");
      expect(vi.mocked(postIntent)).not.toHaveBeenCalled();
    });

    it("returns an explanatory string when networkId is undefined", async () => {
      const wallet = makeMockWallet({
        getNetwork: vi.fn().mockReturnValue({ protocolFamily: "evm" }),
      });

      const result = await provider.executeTransfer(wallet, VALID_ARGS);

      expect(result).toContain("not supported");
      expect(result).toContain("unknown");
    });

    it("returns an explanatory string when chainId is undefined", async () => {
      const wallet = makeMockWallet({
        getNetwork: vi.fn().mockReturnValue({ protocolFamily: "evm", networkId: "base-mainnet" }),
      });

      const result = await provider.executeTransfer(wallet, VALID_ARGS);

      expect(result).toContain("chainId");
    });
  });

  // -------------------------------------------------------------------------
  // executeTransfer — happy path
  // -------------------------------------------------------------------------

  describe("executeTransfer — happy path", () => {
    it("returns a success string containing the intentId on a valid transfer", async () => {
      const wallet = makeMockWallet();

      const result = await provider.executeTransfer(wallet, VALID_ARGS);

      expect(result).toContain("submitted successfully");
      expect(result).toContain("0xabc123");
    });

    it("calls signTypedData exactly once", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      expect(vi.mocked(wallet.signTypedData)).toHaveBeenCalledOnce();
    });

    it("calls postIntent exactly once with the signed payload", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      expect(vi.mocked(postIntent)).toHaveBeenCalledOnce();
      const [, payload] = vi.mocked(postIntent).mock.calls[0] as [string, { signature: string }];
      expect(payload.signature).toBe(MOCK_SIGNATURE);
    });

    it("also succeeds on base-sepolia", async () => {
      const wallet = makeMockWallet({
        getNetwork: vi.fn().mockReturnValue(BASE_SEPOLIA),
      });

      const result = await provider.executeTransfer(wallet, VALID_ARGS);

      expect(result).toContain("submitted successfully");
    });
  });

  // -------------------------------------------------------------------------
  // executeTransfer — EIP-712 payload shape
  // -------------------------------------------------------------------------

  describe("executeTransfer — EIP-712 payload verification", () => {
    it("passes domain with the correct name, version, and chainId to signTypedData", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      const [typedData] = vi.mocked(wallet.signTypedData).mock.calls[0] as [
        { domain: Record<string, unknown> },
      ];
      expect(typedData.domain.name).toBe(EIP712_DOMAIN_TEMPLATE.name);
      expect(typedData.domain.version).toBe(EIP712_DOMAIN_TEMPLATE.version);
      expect(typedData.domain.chainId).toBe(8453);
    });

    it("passes the EIP712_TYPES Intent struct definition", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      const [typedData] = vi.mocked(wallet.signTypedData).mock.calls[0] as [
        { types: typeof EIP712_TYPES },
      ];
      expect(typedData.types).toEqual(EIP712_TYPES);
    });

    it("sets primaryType to 'Intent'", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      const [typedData] = vi.mocked(wallet.signTypedData).mock.calls[0] as [
        { primaryType: string },
      ];
      expect(typedData.primaryType).toBe("Intent");
    });

    it("passes amountIn and minAmountOut as Number in the message (CDP JSON schema compatibility)", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      const [typedData] = vi.mocked(wallet.signTypedData).mock.calls[0] as [
        { message: Record<string, unknown> },
      ];
      expect(typeof typedData.message.amountIn).toBe("number");
      expect(typeof typedData.message.minAmountOut).toBe("number");
      expect(typedData.message.amountIn).toBe(Number("1000000000000000000"));
      expect(typedData.message.minAmountOut).toBe(Number("990000000000000000"));
    });

    it("passes srcChainId, destChainId, and deadline as Number", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      const [typedData] = vi.mocked(wallet.signTypedData).mock.calls[0] as [
        { message: Record<string, unknown> },
      ];
      expect(typeof typedData.message.srcChainId).toBe("number");
      expect(typeof typedData.message.destChainId).toBe("number");
      expect(typeof typedData.message.deadline).toBe("number");
      expect(typedData.message.srcChainId).toBe(8453);
      expect(typedData.message.destChainId).toBe(42161);
    });

    it("passes the agent address extracted from getAddress()", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      const [typedData] = vi.mocked(wallet.signTypedData).mock.calls[0] as [
        { message: Record<string, unknown> },
      ];
      expect(typedData.message.agent).toBe(MOCK_ADDRESS);
    });

    it("passes amountIn as string in the VynxIntent JSON payload (JSON-safe transport)", async () => {
      const wallet = makeMockWallet();

      await provider.executeTransfer(wallet, VALID_ARGS);

      const [, payload] = vi.mocked(postIntent).mock.calls[0] as [
        string,
        { intent: { amountIn: unknown; minAmountOut: unknown } },
      ];
      expect(typeof payload.intent.amountIn).toBe("string");
      expect(typeof payload.intent.minAmountOut).toBe("string");
      expect(payload.intent.amountIn).toBe("1000000000000000000");
    });
  });

  // -------------------------------------------------------------------------
  // executeTransfer — Relayer error handling
  // -------------------------------------------------------------------------

  describe("executeTransfer — Relayer error handling", () => {
    it("returns an explanatory string when postIntent returns ok:false", async () => {
      vi.mocked(postIntent).mockResolvedValueOnce({
        ok: false,
        error: "Relayer rejected the intent with status 400: invalid signature",
      });
      const wallet = makeMockWallet();

      const result = await provider.executeTransfer(wallet, VALID_ARGS);

      expect(typeof result).toBe("string");
      expect(result).toContain("VynX transfer failed");
      expect(result).toContain("invalid signature");
    });
  });

  // -------------------------------------------------------------------------
  // executeTransfer — unexpected errors (catch block)
  // -------------------------------------------------------------------------

  describe("executeTransfer — catch block coverage", () => {
    it("returns an explanatory string when signTypedData throws an Error", async () => {
      const wallet = makeMockWallet({
        signTypedData: vi.fn().mockRejectedValue(new Error("hardware wallet disconnected")),
      });

      const result = await provider.executeTransfer(wallet, VALID_ARGS);

      expect(typeof result).toBe("string");
      expect(result).toContain("unexpected error");
      expect(result).toContain("hardware wallet disconnected");
      expect(vi.mocked(postIntent)).not.toHaveBeenCalled();
    });

    it("returns an explanatory string when signTypedData rejects with a non-Error value", async () => {
      const wallet = makeMockWallet({
        signTypedData: vi.fn().mockRejectedValue("raw string rejection"),
      });

      const result = await provider.executeTransfer(wallet, VALID_ARGS);

      expect(result).toContain("raw string rejection");
    });
  });
});
