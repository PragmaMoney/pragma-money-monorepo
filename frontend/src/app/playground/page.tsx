"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useServiceRegistry } from "@/hooks/useServiceRegistry";
import { useX402Payment } from "@/hooks/useX402Payment";
import { ServiceTester } from "@/components/ServiceTester";
import { PaymentConfirm } from "@/components/PaymentConfirm";
import { Service, PaymentInfo, SERVICE_TYPE_LABELS } from "@/types";
import { formatUSDC } from "@/lib/utils";
import { ChevronDown, Info, AlertCircle, Code } from "lucide-react";
import { useAccount } from "wagmi";

function getProxyResourceId(service: Service): string {
  // Use the bytes32 hex ID — matches the on-chain serviceId
  // and what the register page uses as the proxy resource ID.
  return service.id;
}

function getServiceLabel(service: Service): string {
  if (service.name) return service.name;
  const typeLabel = SERVICE_TYPE_LABELS[service.serviceType] ?? "Service";
  const shortId = service.id.slice(0, 10) + "...";
  return `${typeLabel} ${shortId}`;
}

function PlaygroundContent() {
  const { address, isConnected } = useAccount();
  const searchParams = useSearchParams();
  const { services, isLoading: servicesLoading } = useServiceRegistry();
  const { makePayment, isLoading: paymentLoading, error: paymentError, proxyUrl } = useX402Payment();

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-select service from query param (e.g. /playground?service=0x...)
  useEffect(() => {
    const serviceId = searchParams.get("service");
    if (serviceId && services.length > 0 && !selectedService) {
      const match = services.find((s) => s.id === serviceId);
      if (match) setSelectedService(match);
    }
  }, [searchParams, services, selectedService]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<{
    method: string;
    headers: Record<string, string>;
    body?: string;
    customEndpoint?: string;
  } | null>(null);

  const [response, setResponse] = useState<{
    status: number;
    headers: Record<string, string>;
    body: unknown;
  } | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const handleServiceSelect = (serviceId: string) => {
    const service = services.find((s) => s.id === serviceId);
    setSelectedService(service || null);
    setResponse(null);
    setRequestError(null);
    setIsDropdownOpen(false);
  };

  const handleExecute = async (
    method: string,
    headers: Record<string, string>,
    body?: string,
    customEndpoint?: string
  ) => {
    if (!selectedService) return;

    setPendingRequest({ method, headers, body, customEndpoint });
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = async () => {
    if (!selectedService || !pendingRequest) return;

    try {
      setResponse(null);
      setRequestError(null);

      const resourceId = getProxyResourceId(selectedService);
      // Use custom endpoint if provided (for NATIVE_X402), otherwise use service endpoint
      const effectiveEndpoint = pendingRequest.customEndpoint || selectedService.endpoint;
      const result = await makePayment(
        resourceId,
        pendingRequest.method as "GET" | "POST",
        pendingRequest.body ? JSON.parse(pendingRequest.body) : undefined,
        pendingRequest.headers,
        {
          fundingModel: selectedService.fundingModel,
          endpoint: effectiveEndpoint,
        }
      );

      setResponse({
        status: 200,
        headers: { "content-type": "application/json" },
        body: result,
      });

      setShowPaymentModal(false);
      setPendingRequest(null);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Request failed");
      setShowPaymentModal(false);
    }
  };

  const paymentInfo: PaymentInfo | null = selectedService
    ? {
        service: selectedService,
        calls: 1,
        totalCost: selectedService.pricePerCall,
      }
    : null;

  return (
    <div className="min-h-screen py-12 relative">
      {/* Floating Mascots */}
      <div className="absolute top-20 right-12 pointer-events-none hidden xl:block -rotate-[15deg] drop-shadow-lg">
        <Image src="/picture.png" alt="" width={75} height={75} />
      </div>

      <div className="absolute bottom-32 right-20 pointer-events-none hidden xl:block rotate-[20deg] drop-shadow-lg">
        <Image src="/picture.png" alt="" width={65} height={65} />
      </div>

      <div className="absolute top-64 left-8 pointer-events-none hidden xl:block rotate-[5deg] drop-shadow-lg">
        <Image src="/picture.png" alt="" width={70} height={70} />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12">
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-lobster-dark mb-4">
            API Playground
          </h1>
          <p className="text-xl text-lobster-text max-w-3xl">
            Test and interact with services directly in your browser. Payments are
            handled automatically via x402.
          </p>
        </div>

        {/* Connection Warning */}
        {!isConnected && (
          <div className="card bg-yellow-50 border-2 border-yellow-200 mb-8">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-yellow-700 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-yellow-900 mb-1">
                  Wallet Not Connected
                </h3>
                <p className="text-sm text-yellow-800">
                  Please connect your wallet to test services with automatic payments.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Left Panel - Service Selection */}
          <div className="lg:col-span-2 space-y-6">
            {/* Service Selector */}
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-lobster-dark mb-4">
                Select Service
              </h2>

              {servicesLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="skeleton h-12 w-full" />
                  ))}
                </div>
              ) : (
                <div className="relative" ref={dropdownRef}>
                  {/* Custom Dropdown Trigger */}
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="w-full input-field text-left pr-10 flex items-center justify-between"
                  >
                    <span
                      className={
                        selectedService ? "text-lobster-dark" : "text-lobster-text"
                      }
                    >
                      {selectedService
                        ? getServiceLabel(selectedService)
                        : "Select a service..."}
                    </span>
                    <ChevronDown
                      className={`w-5 h-5 text-lobster-text transition-transform duration-200 ${
                        isDropdownOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {/* Custom Dropdown Panel */}
                  {isDropdownOpen && (
                    <div className="absolute z-50 w-full mt-2 bg-white border-2 border-lobster-border rounded-xl shadow-xl max-h-64 overflow-y-auto">
                      {services.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-lobster-text">
                          No services available
                        </div>
                      ) : (
                        services.map((service) => {
                          const isSelected = selectedService?.id === service.id;
                          return (
                            <button
                              key={service.id}
                              type="button"
                              onClick={() => handleServiceSelect(service.id)}
                              className={`w-full px-4 py-3 text-left transition-colors duration-200 ${
                                isSelected
                                  ? "bg-lobster-primary/10 text-lobster-primary font-medium"
                                  : "text-lobster-dark hover:bg-lobster-hover"
                              }`}
                            >
                              {getServiceLabel(service)}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Service Details */}
            {selectedService && (
              <div className="card overflow-hidden">
                <h3 className="font-display text-lg font-semibold text-lobster-dark mb-4">
                  Service Details
                </h3>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-lobster-text mb-1">Service Name</p>
                    <p className="font-medium text-lobster-dark">
                      {selectedService.name || "Unnamed Service"}
                    </p>
                  </div>

                  {selectedService.description && (
                    <div>
                      <p className="text-xs text-lobster-text mb-1">Description</p>
                      <p className="text-sm text-lobster-dark">
                        {selectedService.description}
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-lobster-text mb-1">Endpoint</p>
                    <p className="text-sm font-mono text-lobster-dark break-all">
                      {selectedService.endpoint}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-lobster-text mb-1">Proxy URL</p>
                    <p className="text-sm font-mono text-lobster-dark break-all">
                      {proxyUrl}/proxy/{getProxyResourceId(selectedService)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-lobster-text mb-1">Price per Call</p>
                    <p className="text-xl sm:text-2xl font-display font-bold text-lobster-primary">
                      ${formatUSDC(selectedService.pricePerCall)}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-lobster-border">
                    <div className="flex items-start space-x-2 text-sm text-lobster-text">
                      <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <p>
                        Payment will be processed automatically when you execute the
                        request.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Schema Info Panel */}
            {selectedService?.schema && (selectedService.schema.input || selectedService.schema.output) && (
              <div className="card bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
                <h3 className="font-display text-lg font-semibold text-blue-900 mb-3 flex items-center gap-2">
                  <Code className="w-5 h-5" />
                  API Schema
                </h3>

                {/* Input Schema */}
                {selectedService.schema.input && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-blue-700 mb-2">INPUT</p>
                    <div className="bg-white/80 rounded-lg p-3 font-mono text-xs">
                      {Object.entries((selectedService.schema.input as Record<string, unknown>).properties || {}).map(([key, prop]) => (
                        <div key={key} className="flex items-start gap-2 mb-1 flex-wrap">
                          <span className="text-blue-600">{key}</span>
                          <span className="text-slate-400">:</span>
                          <span className="text-slate-600">{(prop as { type?: string })?.type || "unknown"}</span>
                          {(prop as { description?: string })?.description && (
                            <span className="text-slate-400 text-[10px]">// {(prop as { description?: string }).description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Output Info */}
                {selectedService.schema.output && (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 mb-2">OUTPUT</p>
                    <div className="bg-white/80 rounded-lg p-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {selectedService.schema.outputContentType || "application/json"}
                      </span>
                      {(selectedService.schema.output as { description?: string })?.description && (
                        <p className="text-xs text-slate-600 mt-2">
                          {(selectedService.schema.output as { description?: string }).description}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Panel - Service Tester */}
          <div className="lg:col-span-3">
            {!selectedService ? (
              <div className="card text-center py-8 sm:py-16">
                <div className="w-16 h-16 sm:w-24 sm:h-24 bg-lobster-surface rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
                  <span className="material-icons text-3xl sm:text-5xl text-lobster-text">
                    play_circle
                  </span>
                </div>
                <h3 className="font-display text-xl sm:text-2xl font-bold text-lobster-dark mb-2 sm:mb-3">
                  Select a Service
                </h3>
                <p className="text-sm sm:text-base text-lobster-text">
                  Choose a service from the dropdown to start testing
                </p>
              </div>
            ) : (
              <ServiceTester
                service={selectedService}
                onExecute={handleExecute}
                isLoading={paymentLoading}
                response={response}
                error={requestError || paymentError?.message}
              />
            )}
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {paymentInfo && (
        <PaymentConfirm
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false);
            setPendingRequest(null);
          }}
          onConfirm={handleConfirmPayment}
          paymentInfo={paymentInfo}
        />
      )}
    </div>
  );
}

export default function PlaygroundPage() {
  return (
    <Suspense>
      <PlaygroundContent />
    </Suspense>
  );
}
