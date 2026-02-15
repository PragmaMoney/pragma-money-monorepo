"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { keccak256, toHex } from "viem";
import { ServiceType, SERVICE_TYPE_LABELS } from "@/types";
import { parseUSDC } from "@/lib/utils";
import {
  SERVICE_REGISTRY_ADDRESS,
  SERVICE_REGISTRY_ABI,
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
  AGENT_POOL_FACTORY_ADDRESS,
  AGENT_POOL_FACTORY_ABI,
} from "@/lib/contracts";
import { CheckCircle, AlertCircle, Wallet, Sparkles, Code } from "lucide-react";
import { cn } from "@/lib/utils";

const SERVICE_TYPE_NAMES: Record<ServiceType, string> = {
  [ServiceType.COMPUTE]: "COMPUTE",
  [ServiceType.STORAGE]: "STORAGE",
  [ServiceType.API]: "API",
  [ServiceType.AGENT]: "AGENT",
  [ServiceType.OTHER]: "OTHER",
};

function SchemaStatus({ schema, label }: { schema: string; label: string }) {
  const isValid = (() => {
    if (!schema.trim()) return true;
    try {
      const parsed = JSON.parse(schema);
      return typeof parsed === 'object' && parsed !== null;
    } catch {
      return false;
    }
  })();

  return (
    <div className={cn(
      "flex items-center space-x-2 mt-2 text-xs",
      isValid ? "text-green-600" : "text-red-600"
    )}>
      {isValid ? (
        <CheckCircle className="w-3 h-3" />
      ) : (
        <AlertCircle className="w-3 h-3" />
      )}
      <span>{label}: {isValid ? "Valid JSON" : "Invalid JSON syntax"}</span>
    </div>
  );
}

export default function RegisterServicePage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [formData, setFormData] = useState({
    name: "",
    serviceId: "",
    serviceType: ServiceType.API,
    pricePerCall: "",
    endpoint: "",
    description: "",
    paymentMode: 0 as 0 | 1,  // 0 = PROXY_WRAPPED, 1 = NATIVE_X402
    inputSchema: "",          // JSON Schema string
    outputSchema: "",         // JSON Schema string
    outputContentType: "application/json" as string,  // Output content type
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [autoGenerateId, setAutoGenerateId] = useState(true);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  // Auto-detect agentId from connected wallet's identity NFT
  const [detectedAgentId, setDetectedAgentId] = useState<bigint | null>(null);
  const [agentIdLoading, setAgentIdLoading] = useState(false);

  useEffect(() => {
    if (!publicClient || !address) {
      setDetectedAgentId(null);
      return;
    }

    let cancelled = false;
    setAgentIdLoading(true);

    (async () => {
      try {
        console.log("[service-page] Detecting agent for address:", address);
        console.log("[service-page] AGENT_POOL_FACTORY_ADDRESS:", AGENT_POOL_FACTORY_ADDRESS);

        // Quick check: does the user own any identity NFTs?
        const balance = await publicClient.readContract({
          address: IDENTITY_REGISTRY_ADDRESS,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "balanceOf",
          args: [address],
        });
        console.log("[service-page] Identity NFT balance:", balance.toString());

        if (cancelled) return;

        if (balance === BigInt(0)) {
          console.log("[service-page] No identity NFTs, returning null");
          setDetectedAgentId(null);
          setAgentIdLoading(false);
          return;
        }

        // Find user's agentId via AgentFactory enumeration + multicall
        // (avoids unreliable getLogs with fromBlock:0 on public RPCs)
        const count = await publicClient.readContract({
          address: AGENT_POOL_FACTORY_ADDRESS,
          abi: AGENT_POOL_FACTORY_ABI,
          functionName: "agentCount",
        });
        console.log("[service-page] AgentPool agentCount:", count.toString());

        if (cancelled) return;

        const agentCount = Number(count);
        if (agentCount === 0) {
          console.log("[service-page] agentCount is 0, returning null");
          setDetectedAgentId(null);
          setAgentIdLoading(false);
          return;
        }

        // Get all agentIds sequentially (no multicall3 on Monad)
        const agentIds: bigint[] = [];
        for (let i = 0; i < agentCount; i++) {
          const id = await publicClient.readContract({
            address: AGENT_POOL_FACTORY_ADDRESS,
            abi: AGENT_POOL_FACTORY_ABI,
            functionName: "getAgentIdAt",
            args: [BigInt(i)],
          });
          agentIds.push(id);
        }
        console.log("[service-page] agentIds:", agentIds.map(id => id.toString()));

        if (cancelled) return;

        // Check ownership sequentially (no multicall3 on Monad)
        let foundAgentId: bigint | null = null;
        for (let i = agentIds.length - 1; i >= 0; i--) {
          const owner = await publicClient.readContract({
            address: IDENTITY_REGISTRY_ADDRESS,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "ownerOf",
            args: [agentIds[i]],
          });
          console.log(`[service-page] Agent ${agentIds[i].toString()} owner: ${owner}, connected: ${address}`);
          if (owner.toLowerCase() === address.toLowerCase()) {
            foundAgentId = agentIds[i];
            break;
          }
        }

        console.log("[service-page] foundAgentId:", foundAgentId?.toString() ?? "null");
        if (!cancelled) {
          setDetectedAgentId(foundAgentId);
        }
      } catch (err) {
        console.error("[service-page] Error detecting agent:", err);
        if (!cancelled) setDetectedAgentId(null);
      } finally {
        if (!cancelled) setAgentIdLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [publicClient, address]);

  const PROXY_URL = process.env.NEXT_PUBLIC_PROXY_URL || "http://localhost:4402";

  const { writeContractAsync } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const generateServiceId = (name: string): string => {
    const cleaned = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const timestamp = Date.now().toString(36);
    return `${cleaned}-${timestamp}`;
  };

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({
      ...prev,
      name,
      serviceId: autoGenerateId ? generateServiceId(name) : prev.serviceId,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Validate form
      if (!formData.name || !formData.endpoint || !formData.pricePerCall) {
        throw new Error("Please fill in all required fields");
      }

      if (detectedAgentId === null) {
        throw new Error("No agent identity found. Register as an agent first.");
      }

      // Validate price
      const priceInSmallestUnit = parseUSDC(formData.pricePerCall);
      if (priceInSmallestUnit <= 0) {
        throw new Error("Price must be greater than 0");
      }

      // Validate endpoint URL
      try {
        new URL(formData.endpoint);
      } catch {
        throw new Error("Please enter a valid endpoint URL");
      }

      // Generate bytes32 serviceId from the string
      const serviceIdBytes32 = keccak256(toHex(formData.serviceId));

      // Use the bytes32 hex as the proxy resource ID (canonical on-chain identifier)
      const proxyResourceId = serviceIdBytes32;
      const proxyEndpoint = `${PROXY_URL}/proxy/${proxyResourceId}`;

      const hash = await writeContractAsync({
        address: SERVICE_REGISTRY_ADDRESS,
        abi: SERVICE_REGISTRY_ABI,
        functionName: "registerService",
        args: [
          serviceIdBytes32,
          detectedAgentId,
          formData.name,
          priceInSmallestUnit,
          proxyEndpoint,
          formData.serviceType,
          formData.paymentMode,  // 0=PROXY_WRAPPED, 1=NATIVE_X402
        ],
      });
      setTxHash(hash);

      // Register on proxy via server-side API route (keeps admin token private)
      try {
        await fetch("/api/register-proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: proxyResourceId,
            name: formData.name,
            type: SERVICE_TYPE_NAMES[formData.serviceType],
            creatorAddress: address,
            originalUrl: formData.endpoint,
            paymentMode: formData.paymentMode === 0 ? "PROXY_WRAPPED" : "NATIVE_X402",
            pricing: {
              pricePerCall: priceInSmallestUnit.toString(),
              currency: "USDC",
            },
            schema: {
              input: formData.inputSchema ? JSON.parse(formData.inputSchema) : null,
              output: formData.outputSchema ? JSON.parse(formData.outputSchema) : null,
              outputContentType: formData.outputContentType,
            },
          }),
        });
      } catch (proxyErr) {
        // Proxy registration failed (non-fatal) - on-chain registration succeeded
      }

      setSubmitSuccess(true);

      // Reset form after success
      setTimeout(() => {
        setFormData({
          name: "",
          serviceId: "",
          serviceType: ServiceType.API,
          pricePerCall: "",
          endpoint: "",
          description: "",
          paymentMode: 0,
          inputSchema: "",
          outputSchema: "",
          outputContentType: "application/json",
        });
        setSubmitSuccess(false);
        setTxHash(undefined);
      }, 3000);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Registration failed";
      if (message.includes("User rejected") || message.includes("denied")) {
        setSubmitError("Transaction was rejected in wallet");
      } else {
        setSubmitError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen py-12">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="card text-center py-16">
            <div className="w-24 h-24 bg-lobster-surface rounded-full flex items-center justify-center mx-auto mb-6">
              <Wallet className="w-12 h-12 text-lobster-text" />
            </div>
            <h2 className="font-display text-3xl font-bold text-lobster-dark mb-4">
              Connect Your Wallet
            </h2>
            <p className="text-lobster-text">
              You need to connect your wallet to register a new service.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 relative">
      {/* Floating Mascots */}
      <div className="absolute top-32 left-8 pointer-events-none hidden xl:block rotate-[-12deg] drop-shadow-lg">
        <Image src="/picture.png" alt="" width={70} height={70} />
      </div>

      <div className="absolute bottom-40 right-12 pointer-events-none hidden xl:block rotate-[25deg] drop-shadow-lg">
        <Image src="/picture.png" alt="" width={75} height={75} />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="font-display text-5xl font-bold text-lobster-dark mb-4">
            Register Your Service
          </h1>
          <p className="text-xl text-lobster-text max-w-2xl mx-auto">
            List your API or service on Clawmono and start earning USDC for every
            call
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Form */}
          <div className="lg:col-span-3">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="card">
                <h2 className="font-display text-2xl font-semibold text-lobster-dark mb-6">
                  Service Details
                </h2>

                {/* Agent Identity Status */}
                {agentIdLoading ? (
                  <div className="mb-6 bg-lobster-surface border-2 border-lobster-border rounded-xl p-4">
                    <div className="flex items-center space-x-2 text-lobster-text">
                      <div className="w-4 h-4 border-2 border-lobster-primary border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Detecting agent identity...</span>
                    </div>
                  </div>
                ) : detectedAgentId !== null ? (
                  <div className="mb-6 bg-[#0000ff]/10 border-2 border-[#0000ff]/20 rounded-xl p-4">
                    <div className="flex items-center space-x-2 text-[#0000ff]">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-semibold">Agent #{detectedAgentId.toString()} detected</span>
                    </div>
                  </div>
                ) : (
                  <div className="mb-6 bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
                    <div className="flex items-start space-x-2 text-amber-800">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-semibold mb-1">No agent identity found</p>
                        <p>
                          You must{" "}
                          <Link href="/register/agent" className="text-lobster-primary hover:underline font-medium">
                            register as an agent
                          </Link>{" "}
                          before you can register a service.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Service Name */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-lobster-dark mb-2">
                    Service Name <span className="text-lobster-primary">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g., GPT-4 Inference API"
                    className="input-field"
                  />
                </div>

                {/* Service ID */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-lobster-dark">
                      Service ID {!autoGenerateId && <span className="text-lobster-primary">*</span>}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setAutoGenerateId(!autoGenerateId);
                        if (autoGenerateId) {
                          setFormData((prev) => ({ ...prev, serviceId: "" }));
                        } else {
                          setFormData((prev) => ({
                            ...prev,
                            serviceId: generateServiceId(prev.name),
                          }));
                        }
                      }}
                      className="text-sm text-lobster-primary hover:text-lobster-hover transition-colors duration-200"
                    >
                      {autoGenerateId ? "Custom ID" : "Auto-generate"}
                    </button>
                  </div>
                  <input
                    type="text"
                    required={!autoGenerateId}
                    disabled={autoGenerateId}
                    value={formData.serviceId}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, serviceId: e.target.value }))
                    }
                    placeholder="service-id-123"
                    className={cn(
                      "input-field",
                      autoGenerateId && "bg-[#F7F5F9] text-[#1C1B1F] placeholder:text-[#7A7287] cursor-not-allowed"
                    )}
                  />
                  <p className="text-xs text-lobster-text mt-1">
                    Unique identifier for your service
                  </p>
                </div>

                {/* Service Type */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-lobster-dark mb-2">
                    Service Type <span className="text-lobster-primary">*</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.entries(SERVICE_TYPE_LABELS).map(([key, label]) => {
                      const typeValue = Number(key) as ServiceType;
                      const isSelected = formData.serviceType === typeValue;

                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({ ...prev, serviceType: typeValue }))
                          }
                          className={cn(
                            "px-4 py-3 rounded-xl font-medium transition-all duration-200 border-2",
                            isSelected
                              ? "bg-lobster-primary text-white shadow-lg"
                              : "bg-white text-lobster-dark border-2 border-lobster-border hover:bg-lobster-soft-hover hover:text-white"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Payment Mode */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-lobster-dark mb-3">
                    Payment Mode <span className="text-lobster-primary">*</span>
                  </label>
                  <div className="space-y-3">
                    <label className={cn(
                      "flex items-start space-x-3 p-4 rounded-xl border-2 cursor-pointer transition-all",
                      formData.paymentMode === 0
                        ? "border-lobster-primary bg-lobster-primary/5"
                        : "border-lobster-border hover:border-lobster-primary/50"
                    )}>
                      <input
                        type="radio"
                        name="paymentMode"
                        checked={formData.paymentMode === 0}
                        onChange={() => setFormData({ ...formData, paymentMode: 0 })}
                        className="mt-1 w-4 h-4 text-lobster-primary"
                      />
                      <div>
                        <span className="text-sm font-medium text-lobster-dark">
                          Proxy-Wrapped (Recommended)
                        </span>
                        <p className="text-xs text-lobster-text mt-1">
                          Clawmono proxy handles x402 payment verification.
                          Your endpoint receives requests after payment is confirmed.
                        </p>
                      </div>
                    </label>
                    <label className={cn(
                      "flex items-start space-x-3 p-4 rounded-xl border-2 cursor-pointer transition-all",
                      formData.paymentMode === 1
                        ? "border-lobster-primary bg-lobster-primary/5"
                        : "border-lobster-border hover:border-lobster-primary/50"
                    )}>
                      <input
                        type="radio"
                        name="paymentMode"
                        checked={formData.paymentMode === 1}
                        onChange={() => setFormData({ ...formData, paymentMode: 1 })}
                        className="mt-1 w-4 h-4 text-lobster-primary"
                      />
                      <div>
                        <span className="text-sm font-medium text-lobster-dark">
                          Native x402
                        </span>
                        <p className="text-xs text-lobster-text mt-1">
                          Your service implements x402 natively and handles its own payment verification.
                          Use for MCP servers with built-in x402 support.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Price */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-lobster-dark mb-2">
                    Price per Call (USDC) <span className="text-lobster-primary">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lobster-text font-semibold">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.000001"
                      min="0"
                      required
                      value={formData.pricePerCall}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, pricePerCall: e.target.value }))
                      }
                      placeholder="1.00"
                      className="input-field pl-8"
                    />
                  </div>
                  <p className="text-xs text-lobster-text mt-1">
                    Amount charged for each API call
                  </p>
                </div>

                {/* Endpoint */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-lobster-dark mb-2">
                    Endpoint URL <span className="text-lobster-primary">*</span>
                  </label>
                  <input
                    type="url"
                    required
                    value={formData.endpoint}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, endpoint: e.target.value }))
                    }
                    placeholder="https://api.example.com/v1/service"
                    className="input-field"
                  />
                  <p className="text-xs text-lobster-text mt-1">
                    Your service's API endpoint URL. It will be wrapped by
                    Clawmono's payment proxy — users will access it through the
                    proxy URL.
                  </p>
                </div>

                {/* Description */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-lobster-dark mb-2">
                    Description (Optional)
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder="Describe what your service does..."
                    rows={4}
                    className="input-field resize-none"
                  />
                </div>

                {/* API Schema for Agent Interoperability */}
                <div className="mb-6">
                  <div className="flex items-center space-x-2 mb-3">
                    <Code className="w-5 h-5 text-lobster-primary" />
                    <label className="text-sm font-medium text-lobster-dark">
                      API Schema (Optional)
                    </label>
                  </div>
                  <p className="text-xs text-lobster-text mb-4">
                    Define input/output schemas so other agents know how to interact with your service.
                    Uses JSON Schema format.
                  </p>

                  <div className="space-y-4 p-4 bg-lobster-surface rounded-xl">
                    {/* Input Schema */}
                    <div>
                      <label className="block text-sm font-medium text-lobster-dark mb-2">
                        Input Schema
                      </label>
                      <textarea
                        value={formData.inputSchema}
                        onChange={(e) => setFormData({ ...formData, inputSchema: e.target.value })}
                        placeholder={`{
  "type": "object",
  "properties": {
    "prompt": { "type": "string" },
    "max_tokens": { "type": "integer", "default": 100 }
  },
  "required": ["prompt"]
}`}
                        rows={6}
                        className="input-field font-mono text-xs resize-none"
                      />
                      {formData.inputSchema && <SchemaStatus schema={formData.inputSchema} label="Input" />}
                    </div>

                    {/* Output Content Type */}
                    <div>
                      <label className="block text-sm font-medium text-lobster-dark mb-2">
                        Output Content Type
                      </label>
                      <select
                        value={formData.outputContentType}
                        onChange={(e) => setFormData({ ...formData, outputContentType: e.target.value })}
                        className="input-field"
                      >
                        <option value="application/json">JSON (structured data)</option>
                        <option value="text/plain">Plain Text</option>
                        <option value="text/markdown">Markdown</option>
                        <option value="image/png">Image (PNG)</option>
                        <option value="image/jpeg">Image (JPEG)</option>
                        <option value="image/svg+xml">SVG</option>
                        <option value="application/zip">Downloadable File</option>
                        <option value="text/uri-list">Links/URIs</option>
                      </select>
                      <p className="text-xs text-lobster-text mt-1">
                        Helps other agents understand what your service returns
                      </p>
                    </div>

                    {/* Output Schema */}
                    <div>
                      <label className="block text-sm font-medium text-lobster-dark mb-2">
                        Output Schema
                      </label>
                      <textarea
                        value={formData.outputSchema}
                        onChange={(e) => setFormData({ ...formData, outputSchema: e.target.value })}
                        placeholder={`{
  "type": "object",
  "properties": {
    "result": { "type": "string" },
    "tokens_used": { "type": "integer" }
  }
}`}
                        rows={6}
                        className="input-field font-mono text-xs resize-none"
                      />
                      {formData.outputSchema && <SchemaStatus schema={formData.outputSchema} label="Output" />}
                    </div>
                  </div>
                </div>

                {/* Error Message */}
                {submitError && (
                  <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-xl p-4">
                    <div className="flex items-start space-x-2 text-red-700">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold mb-1">Registration Failed</p>
                        <p className="text-sm">{submitError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success Message */}
                {submitSuccess && (
                  <div className="mb-6 bg-[#0000ff]/10 border-2 border-[#0000ff]/20 rounded-xl p-4">
                    <div className="flex items-center space-x-2 text-[#0000ff]">
                      <CheckCircle className="w-5 h-5" />
                      <p className="font-semibold">Service registered successfully!</p>
                    </div>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting || isConfirming || submitSuccess || detectedAgentId === null}
                  className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {isSubmitting || isConfirming ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>{isConfirming ? "Confirming..." : "Registering..."}</span>
                    </>
                  ) : submitSuccess ? (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      <span>Registered!</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      <span>Register Service</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Preview */}
          <div className="lg:col-span-2">
            <div className="sticky top-24 space-y-6">
              <div className="card">
                <h3 className="font-display text-xl font-semibold text-lobster-dark mb-4">
                  Preview
                </h3>
                <p className="text-sm text-lobster-text mb-4">
                  This is how your service will appear in the marketplace
                </p>

                <div className="card-hover">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h4 className="font-display text-lg font-semibold text-lobster-dark mb-2">
                        {formData.name || "Service Name"}
                      </h4>
                      <span className="badge bg-lobster-surface text-lobster-primary border border-lobster-border">
                        {SERVICE_TYPE_LABELS[formData.serviceType]}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 text-[#0000ff]">
                      <span className="w-2 h-2 bg-[#0000ff] rounded-full" />
                      <span className="text-xs font-medium">Active</span>
                    </div>
                  </div>

                  {formData.description && (
                    <p className="text-sm text-lobster-text mb-4 line-clamp-2">
                      {formData.description}
                    </p>
                  )}

                  {formData.endpoint && (
                    <div className="text-xs text-lobster-text/60 mb-4 font-mono truncate">
                      {formData.endpoint}
                    </div>
                  )}

                  <div className="pt-4 border-t border-lobster-border">
                    <p className="text-xs text-lobster-text mb-1">Price per Call</p>
                    <p className="font-display text-2xl font-bold text-lobster-primary">
                      ${formData.pricePerCall || "0.00"}
                    </p>
                  </div>

                  {/* Show schema preview if provided */}
                  {(formData.inputSchema || formData.outputSchema) && (
                    <div className="mt-4 pt-4 border-t border-lobster-border">
                      <p className="text-xs text-lobster-text mb-2 flex items-center space-x-1">
                        <Code className="w-3 h-3" />
                        <span>API Schema Defined</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {formData.inputSchema && (
                          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                            Input
                          </span>
                        )}
                        {formData.outputSchema && (
                          <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                            Output
                          </span>
                        )}
                        <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">
                          {formData.outputContentType}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Info Card */}
              <div className="card bg-blue-50 border-2 border-blue-200">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-blue-700 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-2">Before you register:</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li>Ensure your endpoint is publicly accessible</li>
                      <li>Define input/output schemas for agent interoperability</li>
                      <li>Choose Native x402 if your service handles payments directly</li>
                      <li>Set a fair price based on your service cost</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
