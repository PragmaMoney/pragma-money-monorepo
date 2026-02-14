"use client";

import { useState, useEffect, useCallback } from "react";
import { usePublicClient } from "wagmi";
import { Service, ServiceType, FundingModel } from "@/types";
import {
  SERVICE_REGISTRY_ADDRESS,
  SERVICE_REGISTRY_ABI,
} from "@/lib/contracts";

export function useServiceRegistry() {
  const publicClient = usePublicClient();
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchServices = useCallback(async () => {
    if (!publicClient) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Get total count
      const count = await publicClient.readContract({
        address: SERVICE_REGISTRY_ADDRESS,
        abi: SERVICE_REGISTRY_ABI,
        functionName: "getServiceCount",
      });

      if (count === BigInt(0)) {
        setServices([]);
        setIsLoading(false);
        return;
      }

      // 2. Fetch all service IDs in parallel
      const indices = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
      const serviceIds = await Promise.all(
        indices.map((i) =>
          publicClient.readContract({
            address: SERVICE_REGISTRY_ADDRESS,
            abi: SERVICE_REGISTRY_ABI,
            functionName: "getServiceIdAt",
            args: [i],
          })
        )
      );

      // 3. Fetch all service data in parallel
      const serviceDataResults = await Promise.all(
        serviceIds.map((serviceId) =>
          publicClient.readContract({
            address: SERVICE_REGISTRY_ADDRESS,
            abi: SERVICE_REGISTRY_ABI,
            functionName: "getService",
            args: [serviceId],
          })
        )
      );

      // 4. Map to Service objects
      const fetched: Service[] = serviceIds.map((serviceId, i) => {
        const data = serviceDataResults[i];
        return {
          id: serviceId,
          agentId: data.agentId,
          owner: data.owner,
          name: data.name,
          pricePerCall: data.pricePerCall,
          endpoint: data.endpoint,
          serviceType: data.serviceType as ServiceType,
          fundingModel: data.fundingModel as FundingModel,
          active: data.active,
          totalCalls: data.totalCalls,
          totalRevenue: data.totalRevenue,
        };
      });

      setServices(fetched);
    } catch (err) {
      console.error("[useServiceRegistry] Error:", err);
      setError(
        err instanceof Error ? err : new Error("Failed to fetch services")
      );
    } finally {
      setIsLoading(false);
    }
  }, [publicClient]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  return {
    services,
    isLoading,
    error,
    refetch: fetchServices,
  };
}
