import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config, settings } from "../config";

interface ConvertArgs {
  amount: number;
  from: string;
  to: string;
}

interface RatesResponse {
  success: boolean;
  base: string;
  rates: Record<string, number>;
  timestamp: string;
}

// Mock exchange rates (relative to USD)
const MOCK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  CHF: 0.88,
  CAD: 1.35,
  AUD: 1.53,
  NZD: 1.64,
  CNY: 7.24,
  INR: 83.12,
  MXN: 17.05,
  BRL: 4.97,
  KRW: 1328.5,
  SGD: 1.34,
  HKD: 7.82,
};

async function fetchRates(base: string): Promise<RatesResponse> {
  const upperBase = base.toUpperCase();

  if (settings.provider === "exchangerate-api" && settings.apiKey) {
    // Use real API
    const response = await fetch(
      `https://v6.exchangerate-api.com/v6/${settings.apiKey}/latest/${upperBase}`
    );
    const data = await response.json() as {
      result: string;
      conversion_rates: Record<string, number>;
    };

    if (data.result !== "success") {
      throw new Error("Failed to fetch exchange rates");
    }

    return {
      success: true,
      base: upperBase,
      rates: data.conversion_rates,
      timestamp: new Date().toISOString(),
    };
  }

  // Mock mode
  await new Promise((r) => setTimeout(r, 100)); // Simulate latency

  if (!MOCK_RATES[upperBase]) {
    throw new Error(`Unknown currency: ${upperBase}`);
  }

  // Convert all rates relative to the requested base
  const baseRate = MOCK_RATES[upperBase];
  const rates: Record<string, number> = {};

  for (const [currency, rate] of Object.entries(MOCK_RATES)) {
    rates[currency] = Math.round((rate / baseRate) * 10000) / 10000;
  }

  return {
    success: true,
    base: upperBase,
    rates,
    timestamp: new Date().toISOString(),
  };
}

export async function convertCurrency(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[0].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as unknown as ConvertArgs;
  const from = input.from.toUpperCase();
  const to = input.to.toUpperCase();

  try {
    const ratesData = await fetchRates(from);
    const rate = ratesData.rates[to];

    if (rate === undefined) {
      throw new Error(`Unknown target currency: ${to}`);
    }

    const result = Math.round(input.amount * rate * 100) / 100;

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          amount: input.amount,
          from: from,
          to: to,
          result: result,
          rate: rate,
          timestamp: ratesData.timestamp,
        }),
      },
    ];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to convert currency";
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: message,
          from: from,
          to: to,
        }),
      },
    ];
  }
}

export async function getExchangeRates(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[1].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as { base?: string; targets?: string };
  const base = (input.base || "USD").toUpperCase();

  try {
    const ratesData = await fetchRates(base);

    // Filter to requested targets if specified
    if (input.targets) {
      const targetCurrencies = input.targets.toUpperCase().split(",").map((s) => s.trim());
      const filteredRates: Record<string, number> = {};

      for (const currency of targetCurrencies) {
        if (ratesData.rates[currency] !== undefined) {
          filteredRates[currency] = ratesData.rates[currency];
        }
      }

      ratesData.rates = filteredRates;
    }

    return [
      {
        type: "text",
        text: JSON.stringify(ratesData),
      },
    ];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch exchange rates";
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: message,
          base: base,
        }),
      },
    ];
  }
}
