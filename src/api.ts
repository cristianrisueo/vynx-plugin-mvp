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
  try {
    const response = await fetch(`${relayerUrl}/v1/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload, (_key, value) =>
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
      !("intentId" in parsed) ||
      typeof (parsed as Record<string, unknown>).intentId !== "string"
    ) {
      return {
        ok: false,
        error: `Relayer response is missing the required intentId field: ${text}`,
      };
    }

    return { ok: true, intentId: (parsed as { intentId: string }).intentId };
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
