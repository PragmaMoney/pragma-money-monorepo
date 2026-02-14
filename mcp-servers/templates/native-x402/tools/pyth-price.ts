import { ToolHandler, MCPContent } from "../../../shared/types";

interface PythPriceInput {
  priceId?: string;
  asset?: string;
}

const PRICE_IDS: Record<string, string> = {
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

/**
 * Pyth price tool handler - fetches real-time prices from Pyth Hermes.
 */
export const pythPrice: ToolHandler = async (
  args: Record<string, unknown>
): Promise<MCPContent[]> => {
  const { priceId, asset } = args as PythPriceInput;

  const id =
    priceId || (asset ? PRICE_IDS[asset.toUpperCase()] : PRICE_IDS["ETH"]);
  if (!id) {
    return [
      {
        type: "text",
        text: JSON.stringify({ error: `Unknown asset: ${asset}` }),
      },
    ];
  }

  try {
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}`;
    const res = await fetch(url);
    const data = await res.json();

    const parsed = data.parsed?.[0];
    if (parsed) {
      const price =
        Number(parsed.price.price) * Math.pow(10, parsed.price.expo);
      return [
        {
          type: "text",
          text: JSON.stringify({
            asset: asset?.toUpperCase() || "ETH",
            price: price.toFixed(2),
            confidence: parsed.price.conf,
            publishTime: new Date(
              parsed.price.publish_time * 1000
            ).toISOString(),
          }),
        },
      ];
    }

    return [{ type: "text", text: JSON.stringify(data) }];
  } catch (error) {
    return [
      {
        type: "text",
        text: JSON.stringify({
          error: `Failed to fetch price: ${error instanceof Error ? error.message : "Unknown error"}`,
        }),
      },
    ];
  }
};
