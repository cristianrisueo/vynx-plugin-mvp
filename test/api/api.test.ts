import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postIntent } from "../../src/api.js";
import type { IntentPayload } from "../../src/types.js";

const RELAYER_URL = "https://relayer.vynx.internal";

const MOCK_PAYLOAD: IntentPayload = {
  intent: {
    intentId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    agent: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    srcChainId: 8453,
    destChainId: 42161,
    srcToken: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    destToken: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    amountIn: "1000000000000000000",
    minAmountOut: "990000000000000000",
    deadline: 1_700_000_000 + 300,
  },
  signature: "0xdeadbeef",
};

describe("postIntent", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it("returns ok:true with intentId on a 2xx response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ intent_id: "0xdeadbeef01", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intentId).toBe("0xdeadbeef01");
  });

  it("sends a POST request to /v1/intent with JSON content-type", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ intent_id: "0x01", status: "queued" }), { status: 200 }),
    );

    await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/intent`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("maps IntentPayload fields to the flat Relayer wire format", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ intent_id: "0x01", status: "queued" }), { status: 200 }),
    );

    await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body.id).toBe(MOCK_PAYLOAD.intent.intentId);
    expect(body.sender).toBe(MOCK_PAYLOAD.intent.agent);
    expect(body.token_in).toBe(MOCK_PAYLOAD.intent.srcToken);
    expect(body.token_out).toBe(MOCK_PAYLOAD.intent.destToken);
    expect(body.amount_in).toBe(MOCK_PAYLOAD.intent.amountIn);
    expect(body.min_amount_out).toBe(MOCK_PAYLOAD.intent.minAmountOut);
    expect(body.deadline).toBe(MOCK_PAYLOAD.intent.deadline);
    expect(body.signature).toBe(MOCK_PAYLOAD.signature);
    // srcChainId and destChainId must NOT be forwarded (relayer uses DisallowUnknownFields)
    expect(body).not.toHaveProperty("srcChainId");
    expect(body).not.toHaveProperty("destChainId");
  });

  it("serialises BigInt amounts as strings in the request body", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ intent_id: "0x01", status: "queued" }), { status: 200 }),
    );

    // Pass bigint values to exercise the JSON replacer branch.
    const payloadWithBigInt = {
      ...MOCK_PAYLOAD,
      intent: {
        ...MOCK_PAYLOAD.intent,
        amountIn: 1000000000000000000n,
        minAmountOut: 990000000000000000n,
      },
    } as unknown as IntentPayload;

    await postIntent(RELAYER_URL, payloadWithBigInt);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { amount_in: unknown };
    expect(typeof body.amount_in).toBe("string");
    expect(body.amount_in).toBe("1000000000000000000");
  });

  // ---------------------------------------------------------------------------
  // Relayer 4xx errors — signature / validation rejections
  // ---------------------------------------------------------------------------

  it("returns ok:false with explanatory error on a 400 response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("invalid signature", { status: 400 }));

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("400");
    expect(result.error).toContain("invalid signature");
  });

  it("returns ok:false with explanatory error on a 422 response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("intent already exists", { status: 422 }));

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("422");
  });

  // ---------------------------------------------------------------------------
  // Relayer 5xx errors — infrastructure failures
  // ---------------------------------------------------------------------------

  it("returns ok:false with explanatory error on a 500 response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("internal server error", { status: 500 }));

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("500");
  });

  it("returns ok:false with explanatory error on a 503 response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("service unavailable", { status: 503 }));

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("503");
  });

  // ---------------------------------------------------------------------------
  // Malformed Relayer responses
  // ---------------------------------------------------------------------------

  it("returns ok:false when the 200 body is not valid JSON", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("not-json-at-all", { status: 200 }));

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not valid JSON");
  });

  it("returns ok:false when the 200 body is JSON but missing intent_id", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "queued" }), { status: 200 }),
    );

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("intent_id");
  });

  it("returns ok:false when intent_id is present but not a string", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ intent_id: 12345, status: "queued" }), { status: 200 }),
    );

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("intent_id");
  });

  // ---------------------------------------------------------------------------
  // Network-level failures — timeout and connectivity
  // ---------------------------------------------------------------------------

  it("returns ok:false with timeout message when the request is aborted (AbortError)", async () => {
    fetchSpy.mockImplementationOnce(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("timed out");
  });

  it("returns ok:false with timeout message when AbortSignal.timeout fires (TimeoutError)", async () => {
    fetchSpy.mockImplementationOnce(() => {
      const err = new Error("The signal timed out");
      err.name = "TimeoutError";
      return Promise.reject(err);
    });

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("timed out");
  });

  it("returns ok:false when fetch rejects with a generic network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns ok:false when fetch rejects with a non-Error object", async () => {
    fetchSpy.mockRejectedValueOnce("raw string rejection");

    const result = await postIntent(RELAYER_URL, MOCK_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("raw string rejection");
  });
});
