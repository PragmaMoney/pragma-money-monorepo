#!/usr/bin/env tsx
import "dotenv/config";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { config } from "../src/config.js";

const RPC_URL = process.env.RPC_URL || config.gatewayRpcUrl;
const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:4402";
const OPERATOR_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY;
const IDENTITY_REGISTRY_ADDRESS =
  process.env.IDENTITY_REGISTRY_ADDRESS || config.identityRegistryAddress;

const IDENTITY_REGISTRY_ABI = [
  "function register(string agentURI) returns (uint256)",
  "function lastId() view returns (uint256)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
];

const CHAIN_ID = 10143;

async function main() {
  if (!OPERATOR_PRIVATE_KEY) {
    throw new Error("TEST_PRIVATE_KEY is required");
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const operator = new Wallet(OPERATOR_PRIVATE_KEY, provider);
  const operatorAddress = await operator.getAddress();

  console.log("=== Create Agent + Pool ===");
  console.log("Relayer:", RELAYER_URL);
  console.log("RPC:", RPC_URL);
  console.log("Operator:", operatorAddress);
  console.log("IdentityRegistry:", IDENTITY_REGISTRY_ADDRESS);
  console.log("");

  // Phase 1: Fund + get metadataURI
  const fundRes = await fetch(`${RELAYER_URL}/register-agent/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operatorAddress,
      name: "Agent",
      description: "Created via create-agent script",
      dailyLimit: "100",
      expiryDays: 90,
      poolDailyCap: "50",
      poolVestingDays: 30,
    }),
  });
  const fundJson = (await fundRes.json()) as { error?: string; metadataURI?: string };
  if (fundJson.error) throw new Error(`Fund failed: ${fundJson.error}`);
  const metadataURI = fundJson.metadataURI as string;
  console.log("metadataURI:", metadataURI);

  // Register agent
  const identityRegistry = new Contract(
    IDENTITY_REGISTRY_ADDRESS,
    IDENTITY_REGISTRY_ABI,
    operator,
  );
  const regTx = await identityRegistry.register(metadataURI);
  const regReceipt = await regTx.wait();

  // Try to extract agentId from logs, fallback to lastId-1
  let agentId = "0";
  for (const log of regReceipt.logs) {
    if (log.topics.length >= 2) {
      const potentialId = BigInt(log.topics[1]).toString();
      if (potentialId !== "0") {
        agentId = potentialId;
        break;
      }
    }
  }
  if (agentId === "0") {
    const lastId = (await identityRegistry.lastId()) as bigint;
    agentId = (lastId - 1n).toString();
  }
  console.log("agentId:", agentId);

  // Phase 2: Setup smart account
  // Wait for register tx to be confirmed and indexed
  await new Promise((r) => setTimeout(r, 5000));
  const setupRes = await fetch(`${RELAYER_URL}/register-agent/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatorAddress, agentId }),
  });
  const setupJson = (await setupRes.json()) as {
    error?: string;
    smartAccountAddress?: string;
    deadline?: number;
    deployerAddress?: string;
  };
  if (setupJson.error) {
    const details = (setupJson as { details?: string }).details;
    throw new Error(`Setup failed: ${setupJson.error}${details ? ` (${details})` : ""}`);
  }
  const smartAccountAddress = setupJson.smartAccountAddress as string;
  const deadline = setupJson.deadline as number;
  console.log("smartAccount:", smartAccountAddress);

  // Phase 2.5: set agent wallet via EIP-712
  const domain = {
    name: "ERC8004IdentityRegistry",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: IDENTITY_REGISTRY_ADDRESS,
  };
  const types = {
    AgentWalletSet: [
      { name: "agentId", type: "uint256" },
      { name: "newWallet", type: "address" },
      { name: "owner", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value = {
    agentId: BigInt(agentId),
    newWallet: smartAccountAddress,
    owner: operatorAddress,
    deadline: BigInt(deadline),
  };
  const sig = await operator.signTypedData(domain, types, value);
  const setWalletTx = await identityRegistry.setAgentWallet(
    BigInt(agentId),
    smartAccountAddress,
    BigInt(deadline),
    sig,
  );
  await setWalletTx.wait();
  console.log("setAgentWallet: done");

  // Phase 3: Finalize (create pool)
  // Wait for setAgentWallet tx to be confirmed and indexed
  await new Promise((r) => setTimeout(r, 8000));
  const finalRes = await fetch(`${RELAYER_URL}/register-agent/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatorAddress, agentId }),
  });
  const finalJson = (await finalRes.json()) as { error?: string; poolAddress?: string };
  if (finalJson.error) throw new Error(`Finalize failed: ${finalJson.error}`);
  const poolAddress = finalJson.poolAddress as string;
  console.log("poolAddress:", poolAddress);

  console.log("");
  console.log("=== Done ===");
  console.log("agentId:", agentId);
  console.log("smartAccount:", smartAccountAddress);
  console.log("poolAddress:", poolAddress);
}

main().catch((err) => {
  console.error("Create agent failed:", err);
  process.exit(1);
});
