import type { IntentPayload } from "./types.js";

export interface RelayerResponse {
  ok: true;
  intentId: string;
}

export interface RelayerError {
  ok: false;
  error: string;
}

export type RelayerResult = RelayerResponse | RelayerError;

const RELAYER_TIMEOUT_MS = 5_000;

/**
 * Submits a signed VynX intent to the Relayer REST API.
 *
 * Never throws. On any network failure or non-2xx response the function
 * returns a RelayerError so the AgentKit reasoning loop can handle it
 * as an explanatory string without crashing the Node process.
 */
export async function postIntent(
  relayerUrl: string,
  payload: IntentPayload,
): Promise<RelayerResult> {
  // Map the internal IntentPayload to the flat wire format the Relayer expects.
  // srcChainId and destChainId are used only for EIP-712 signing and are not
  // forwarded — the Relayer handles cross-chain routing internally.
  const wireBody = {
    id: payload.intent.intentId,
    sender: payload.intent.agent,
    token_in: payload.intent.srcToken,
    token_out: payload.intent.destToken,
    amount_in: payload.intent.amountIn,
    min_amount_out: payload.intent.minAmountOut,
    deadline: payload.intent.deadline,
    nonce: 0,
    signature: payload.signature,
  };

  try {
    const response = await fetch(`${relayerUrl}/v1/intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wireBody, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
      signal: AbortSignal.timeout(RELAYER_TIMEOUT_MS),
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: `Relayer rejected the intent with status ${response.status}: ${text}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: `Relayer returned status ${response.status} but the response body is not valid JSON: ${text}`,
      };
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("intent_id" in parsed) ||
      typeof (parsed as Record<string, unknown>).intent_id !== "string"
    ) {
      return {
        ok: false,
        error: `Relayer response is missing the required intent_id field: ${text}`,
      };
    }

    return { ok: true, intentId: (parsed as { intent_id: string }).intent_id };
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    if (isTimeout) {
      return {
        ok: false,
        error: `Relayer request timed out after ${RELAYER_TIMEOUT_MS}ms. The network may be congested or the endpoint unreachable.`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Unexpected network error communicating with the Relayer: ${message}`,
    };
  }
}
