# Payment Flows Analysis

## Summary

| Path | Who Splits | Proxy Action |
|------|------------|--------------|
| **Path A** (Facilitator/PAYMENT-SIGNATURE) | Proxy | Proxy receives all, then splits 40/60 |
| **Path B** (Gateway/x-payment-id) | x402Gateway Contract | Only record usage (no split) |

## Buy Side (Payers)

| # | Buyer Type | Payment Flow | Header | Who Handles |
|---|------------|--------------|--------|-------------|
| 1 | EOA Human | Facilitator | `PAYMENT-SIGNATURE` | Frontend signs ERC-3009 → Facilitator settles |
| 2 | EOA Agent | Facilitator | `PAYMENT-SIGNATURE` | CLI signs ERC-3009 → Facilitator settles |
| 3 | Smart Account Agent | x402Gateway | `x-payment-id` | UserOp → Gateway.payForService() |
| 4 | Smart Account Human | x402Gateway | `x-payment-id` | Same as #3 |

## Sell Side (Receivers)

| # | Funding Model | Pool Required | Path A Routing | Path B Routing |
|---|---------------|---------------|----------------|----------------|
| 1 | PROXY_WRAPPED | Yes (mandatory) | Facilitator → Proxy signer → Proxy splits 40/60 | Gateway splits 40/60 directly |
| 2 | NATIVE_X402 + Pool | Optional | Facilitator → Owner directly | Gateway → Owner (100%) |
| 3 | NATIVE_X402 (solo) | No | Facilitator → Owner directly | Gateway → Owner (100%) |

## Detailed Flow: Path A (Facilitator)

```
┌─────────────┐     ┌─────────┐     ┌─────────────┐     ┌────────────┐
│   Client    │────▶│  Proxy  │────▶│ Facilitator │────▶│  On-Chain  │
│ (EOA/Human) │     │ (402)   │     │  /settle    │     │  Transfer  │
└─────────────┘     └─────────┘     └─────────────┘     └────────────┘
                          │
                          ▼
                    ┌─────────────┐
                    │ PROXY_WRAPPED? │
                    │ Proxy splits  │
                    │ 40% pool      │
                    │ 60% wallet    │
                    └─────────────┘
```

1. Client signs `TransferWithAuthorization` (ERC-3009)
2. Client sends request with `PAYMENT-SIGNATURE` header
3. Proxy decodes, forwards to Monad facilitator `/settle`
4. Facilitator executes transfer to `payTo` address
5. For PROXY_WRAPPED: `payTo` = proxy signer → Proxy does 40/60 split
6. For NATIVE_X402: `payTo` = service owner → No split needed

## Detailed Flow: Path B (Gateway)

```
┌─────────────┐     ┌───────────┐     ┌─────────┐
│ Smart Acct  │────▶│ x402Gate  │────▶│  Proxy  │
│   Agent     │     │ .payFor   │     │ verify  │
└─────────────┘     │ Service() │     └─────────┘
                    └───────────┘
                          │
                          ▼
                    ┌─────────────┐
                    │ Gateway does│
                    │ PROXY_WRAP: │
                    │ 40% pool    │
                    │ 60% wallet  │
                    │ NATIVE_X402:│
                    │ 100% wallet │
                    └─────────────┘
```

1. Agent sends UserOp: `approve USDC` + `payForService(serviceId, calls)`
2. x402Gateway receives USDC, splits per fundingModel
3. Gateway emits `ServicePaid(paymentId)`
4. Agent calls proxy with `x-payment-id: <paymentId>`
5. Proxy verifies on-chain via `gateway.verifyPayment(paymentId)`
6. Proxy only records usage (split already done by gateway)

## Current Implementation Status

| Path | Frontend | CLI (EOA) | CLI (SmartAccount) |
|------|----------|-----------|-------------------|
| Path A (Facilitator) | ✅ Working | ❌ TODO | ❌ N/A |
| Path B (Gateway) | ❌ N/A | ❌ N/A | ✅ Working |

## Bug Fixed

Path B was incorrectly calling `fireSplitAndRecordUsage()` which would try to split AGAIN after the gateway already split. Fixed to only call `fireRecordUsage()`.

## TODO: Add EOA Facilitator to CLI

Add a new CLI command for EOA agents to use the facilitator flow:

```bash
pragma-agent pay-facilitator --service-id 0x... --calls 1
```

Implementation:
1. Sign `TransferWithAuthorization` using EOA private key
2. Build x402 v2 payload
3. Call facilitator `/settle` directly
4. Make HTTP request with `PAYMENT-SIGNATURE` header

OR simpler:
```bash
pragma-agent call --service-id 0x... --use-facilitator
```

This would use the same `@x402/fetch` + `@x402/evm` packages as frontend.

## Test Matrix

| Buyer | Seller | Path | Status |
|-------|--------|------|--------|
| EOA Human | PROXY_WRAPPED | A | ✅ Tested ($0.02) |
| EOA Human | NATIVE_X402 | A | ❌ TODO |
| EOA Agent | PROXY_WRAPPED | A | ❌ TODO |
| EOA Agent | NATIVE_X402 | A | ❌ TODO |
| SmartAcct Agent | PROXY_WRAPPED | B | ❌ TODO |
| SmartAcct Agent | NATIVE_X402 | B | ❌ TODO |
