import { JsonRpcProvider } from "ethers";

/**
 * Global in-memory nonce manager for the deployer wallet.
 *
 * Public RPCs behind load balancers return stale nonces. Instead of querying
 * getTransactionCount on each request (which races under concurrent calls),
 * we track the nonce in-memory. Initialized once from RPC, then incremented
 * synchronously via allocateNonce().
 *
 * Node.js is single-threaded so the synchronous read+increment in
 * allocateNonce() is atomic — no two callers can get the same value.
 */

let _nonce: number | null = null;
let _syncPromise: Promise<void> | null = null;

export async function syncDeployerNonce(provider: JsonRpcProvider, address: string): Promise<void> {
  if (_syncPromise) { await _syncPromise; return; }
  _syncPromise = (async () => {
    const chainNonce = await provider.getTransactionCount(address, "pending");
    if (_nonce === null || chainNonce > _nonce) {
      _nonce = chainNonce;
      console.log(`[nonce-manager] Synced deployer nonce: ${_nonce}`);
    }
  })();
  await _syncPromise;
  _syncPromise = null;
}

export function allocateNonce(): number {
  if (_nonce === null) throw new Error("Deployer nonce not initialized — call syncDeployerNonce first");
  return _nonce++;
}
