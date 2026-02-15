"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatUnits, type Address } from "viem";
import { SCORE_ORACLE_ADDRESS } from "@/lib/contracts";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
import { useAgentPool } from "@/hooks/useAgentPool";

const SCORE_ORACLE_ABI = [
  {
    type: "function",
    name: "calculateScore",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "tag1s", type: "string[]" },
      { name: "tag2s", type: "string[]" },
      { name: "weightsBps", type: "int32[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

export default function ScorePage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { agents, isLoading: loadingAgents } = useAgentRegistry();

  const [agentId, setAgentId] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  const agentOptions = useMemo(
    () =>
      agents
        .slice()
        .sort((a, b) => Number(b.agentId - a.agentId))
        .map((agent) => ({
          id: agent.agentId.toString(),
          label: `${agent.name || `Agent #${agent.agentId.toString()}`} (id ${agent.agentId.toString()})`,
        })),
    [agents]
  );

  useEffect(() => {
    if (!agentId && agentOptions.length) {
      setAgentId(agentOptions[0].id);
    }
  }, [agentId, agentOptions]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.agentId.toString() === agentId),
    [agents, agentId]
  );
  const poolAddress = (selectedAgent?.poolAddress as Address | undefined);
  const { pool, isLoading: poolLoading, error: poolError } = useAgentPool(poolAddress, undefined);

  const formatUsdc = (value: bigint) => formatUnits(value, 6);

  const parsed = useMemo(() => {
    const tag1List = ["score"];
    const tag2List = [""];
    const weightList = [10000];
    return { tag1List, tag2List, weightList };
  }, []);

  const handleSubmit = async () => {
    setError(null);

    if (!isConnected || !address) {
      setError("Connect your wallet first.");
      return;
    }
    if (!agentId.trim()) {
      setError("Agent ID is required.");
      return;
    }

    const { tag1List, tag2List, weightList } = parsed;
    if (weightList.some((value) => value < INT32_MIN || value > INT32_MAX)) {
      setError("Weights must fit within int32 range.");
      return;
    }

    const resolvedTag2s = tag2List;

    try {
      const hash = await writeContractAsync({
        address: SCORE_ORACLE_ADDRESS as Address,
        abi: SCORE_ORACLE_ABI,
        functionName: "calculateScore",
        args: [BigInt(agentId), tag1List, resolvedTag2s, weightList],
      });
      setTxHash(hash);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  return (
    <div className="container mx-auto px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="card p-8">
          <h1 className="text-3xl font-display font-bold text-lobster-dark mb-4">
            Score Oracle
          </h1>
          <p className="text-lobster-text mb-6">
            Call <span className="font-semibold">calculateScore</span> on the
            ScoreOracle to update an agent’s score and pool cap based on tags and
            weights.
          </p>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-lobster-dark mb-2">
                Agent ID
              </label>
              <select
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-lobster-border bg-white focus:outline-none focus:ring-2 focus:ring-lobster-primary/30"
              >
                <option value="" disabled>
                  {loadingAgents ? "Loading agents..." : "Select an agent"}
                </option>
                {agentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!loadingAgents && agentOptions.length === 0 && (
                <p className="text-xs text-lobster-text mt-2">
                  No registered agents found on-chain yet.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-lobster-border bg-lobster-muted/40 px-4 py-3 text-sm text-lobster-text">
              Tags and weights:
              <div className="mt-2 text-xs text-lobster-dark">
                tag1: <span className="font-semibold">score</span> · tag2:{" "}
                <span className="font-semibold">(empty)</span> · weight:{" "}
                <span className="font-semibold">10000</span> bps
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-lobster-border bg-white/90 p-4 text-sm text-black">
            <div className="text-sm font-semibold text-black mb-2">Agent Pool</div>
            {poolLoading && <div className="text-black">Loading pool info...</div>}
            {poolError && <div className="text-red-600">Failed to load pool info.</div>}
            {!poolLoading && !poolError && !pool && (
              <div className="text-black">No pool found for this agent.</div>
            )}
            {pool && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-black/70">Pool Address</div>
                  <div className="font-mono text-[11px] break-all">{poolAddress}</div>
                </div>
                <div>
                  <div className="text-black/70">Daily Cap</div>
                  <div className="font-semibold">{formatUsdc(pool.dailyCap)} USDC</div>
                </div>
                <div>
                  <div className="text-black/70">Remaining Today</div>
                  <div className="font-semibold">{formatUsdc(pool.remainingCapToday)} USDC</div>
                </div>
                <div>
                  <div className="text-black/70">Spent Today</div>
                  <div className="font-semibold">{formatUsdc(pool.spentToday)} USDC</div>
                </div>
                <div>
                  <div className="text-black/70">Total Assets</div>
                  <div className="font-semibold">{formatUsdc(pool.totalAssets)} USDC</div>
                </div>
                <div>
                  <div className="text-black/70">Total Shares</div>
                  <div className="font-semibold">{formatUnits(pool.totalSupply, 18)}</div>
                </div>
                <div>
                  <div className="text-black/70">Vesting Duration</div>
                  <div className="font-semibold">{pool.vestingDuration.toString()}s</div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
              {error}
            </div>
          )}

          {txHash && (
            <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-700 text-sm">
              Submitted tx: {txHash}
            </div>
          )}

          {receipt?.status === "success" && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-700 text-sm">
              Score updated successfully.
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isConfirming}
            className="mt-8 w-full bg-lobster-primary text-white rounded-xl py-3 font-semibold hover:bg-lobster-hover transition-colors duration-200 disabled:opacity-70"
          >
            {isConfirming ? "Submitting..." : "Calculate Score"}
          </button>
        </div>
      </div>
    </div>
  );
}
