"use client";

import { useState, useEffect, useCallback } from "react";
import { createPublicClient, http, type Address } from "viem";
import type { Agent } from "@/types";
import { monadTestnet } from "@/lib/chain";
import {
  AGENT_POOL_FACTORY_ADDRESS,
  AGENT_POOL_FACTORY_ABI,
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
} from "@/lib/contracts";

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.NEXT_PUBLIC_MONAD_RPC || "https://testnet-rpc.monad.xyz"),
});

export function useAgentRegistry() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 1. Read agent count from AgentFactory
      const count = await publicClient.readContract({
        address: AGENT_POOL_FACTORY_ADDRESS,
        abi: AGENT_POOL_FACTORY_ABI,
        functionName: "agentCount",
      });

      if (count === BigInt(0)) {
        setAgents([]);
        setIsLoading(false);
        return;
      }

      // 2. Fetch all agent IDs in parallel
      const indices = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
      const agentIds = await Promise.all(
        indices.map((i) =>
          publicClient.readContract({
            address: AGENT_POOL_FACTORY_ADDRESS,
            abi: AGENT_POOL_FACTORY_ABI,
            functionName: "getAgentIdAt",
            args: [i],
          }).catch(() => null)
        )
      );

      // Filter out failed fetches
      const validAgentIds = agentIds.filter((id): id is bigint => id !== null);

      if (validAgentIds.length === 0) {
        setAgents([]);
        setIsLoading(false);
        return;
      }

      // 3. Fetch agent data in parallel for each agent
      const agentDataPromises = validAgentIds.map(async (agentId) => {
        try {
          const [poolAddress, owner, walletAddress, agentURI] = await Promise.all([
            publicClient.readContract({
              address: AGENT_POOL_FACTORY_ADDRESS,
              abi: AGENT_POOL_FACTORY_ABI,
              functionName: "poolByAgentId",
              args: [agentId],
            }) as Promise<Address>,
            publicClient.readContract({
              address: IDENTITY_REGISTRY_ADDRESS,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "ownerOf",
              args: [agentId],
            }) as Promise<Address>,
            publicClient.readContract({
              address: IDENTITY_REGISTRY_ADDRESS,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "getAgentWallet",
              args: [agentId],
            }) as Promise<Address>,
            publicClient.readContract({
              address: IDENTITY_REGISTRY_ADDRESS,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "tokenURI",
              args: [agentId],
            }) as Promise<string>,
          ]);

          // Parse name from agentURI JSON
          let name = `Agent #${agentId}`;
          try {
            const parsed = JSON.parse(agentURI);
            if (parsed.name) name = parsed.name;
          } catch {
            // agentURI is not valid JSON, use fallback name
          }

          return {
            agentId,
            owner,
            walletAddress,
            agentURI,
            name,
            poolAddress,
          } as Agent;
        } catch {
          // Skip agents that can't be read
          return null;
        }
      });

      const agentResults = await Promise.all(agentDataPromises);
      const fetched = agentResults.filter((a): a is Agent => a !== null);

      setAgents(fetched);
    } catch (err) {
      console.error("[useAgentRegistry] Error:", err);
      setError(err instanceof Error ? err : new Error("Failed to fetch agents"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, isLoading, error, refetch: fetchAgents };
}
