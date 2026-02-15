import "dotenv/config";
import express from "express";
import cors from "cors";
import { MCPServer } from "./shared/mcp-server";
import type { MCPServiceConfig, ToolHandler } from "./shared/types";

import { config as imageConfig, settings as imageSettings } from "./image-generator/config";
import { generateImage } from "./image-generator/tools/generate-image";
import { config as weatherConfig, settings as weatherSettings } from "./weather-api/config";
import { getCurrentWeather } from "./weather-api/tools/get-current";
import { getForecast } from "./weather-api/tools/get-forecast";
import { config as qrConfig } from "./qr-code-generator/config";
import { generateQR } from "./qr-code-generator/tools/generate-qr";
import { config as hashConfig } from "./hash-generator/config";
import { generateHash } from "./hash-generator/tools/generate-hash";
import { config as jsonConfig } from "./json-formatter/config";
import { formatJSON } from "./json-formatter/tools/format-json";
import { config as currencyConfig, settings as currencySettings } from "./currency-converter/config";
import {
  convertCurrency,
  getExchangeRates,
} from "./currency-converter/tools/convert-currency";
import { config as metadataConfig, settings as metadataSettings } from "./url-metadata/config";
import { extractMetadata } from "./url-metadata/tools/extract-metadata";
import { config as markdownConfig } from "./markdown-to-html/config";
import { convertMarkdown } from "./markdown-to-html/tools/convert-md";

type ServiceMount = {
  slug: string;
  server: MCPServer;
  tools: string[];
};

function buildServer(
  slug: string,
  ownerAddress: string,
  args: {
    config: MCPServiceConfig;
    serviceId?: string;
    handlers: Record<string, ToolHandler>;
  }
): ServiceMount {
  const server = new MCPServer(args.config, ownerAddress, args.serviceId);
  for (const [toolName, handler] of Object.entries(args.handlers)) {
    server.registerTool(toolName, handler);
  }
  return {
    slug,
    server,
    tools: Object.keys(args.handlers),
  };
}

async function main() {
  const ownerAddress = process.env.OWNER_ADDRESS || "";
  if (!ownerAddress) {
    console.error("ERROR: OWNER_ADDRESS environment variable is required");
    process.exit(1);
  }

  const app = express();
  app.use(cors());

  const mounts: ServiceMount[] = [
    buildServer("image-generator", ownerAddress, {
      config: imageConfig,
      handlers: { generate_image: generateImage },
    }),
    buildServer("weather-api", ownerAddress, {
      config: weatherConfig,
      handlers: {
        get_current_weather: getCurrentWeather,
        get_forecast: getForecast,
      },
    }),
    buildServer("qr-code-generator", ownerAddress, {
      config: qrConfig,
      handlers: { generate_qr: generateQR },
    }),
    buildServer("hash-generator", ownerAddress, {
      config: hashConfig,
      handlers: { generate_hash: generateHash },
    }),
    buildServer("json-formatter", ownerAddress, {
      config: jsonConfig,
      handlers: { format_json: formatJSON },
    }),
    buildServer("currency-converter", ownerAddress, {
      config: currencyConfig,
      serviceId: currencySettings.serviceId || undefined,
      handlers: {
        convert_currency: convertCurrency,
        get_exchange_rates: getExchangeRates,
      },
    }),
    buildServer("url-metadata", ownerAddress, {
      config: metadataConfig,
      serviceId: metadataSettings.serviceId || undefined,
      handlers: { extract_metadata: extractMetadata },
    }),
    buildServer("markdown-to-html", ownerAddress, {
      config: markdownConfig,
      handlers: { convert_markdown: convertMarkdown },
    }),
  ];

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      mode: "single",
      serviceCount: mounts.length,
      services: mounts.map((m) => m.slug),
    });
  });

  app.get("/services", (_req, res) => {
    res.json(
      mounts.map((m) => ({
        slug: m.slug,
        mcp: `/${m.slug}/mcp`,
        info: `/${m.slug}/info`,
        health: `/${m.slug}/health`,
        tools: m.tools.map((toolName) => `/${m.slug}/tools/${toolName}`),
      }))
    );
  });

  for (const mount of mounts) {
    app.use(`/${mount.slug}`, mount.server.getApp());
  }

  const port = parseInt(
    process.env.MCP_UNIFIED_PORT || process.env.PORT || "3099",
    10
  );
  app.listen(port, () => {
    console.log(`MCP server running on ${port}`);
  });

  if (weatherSettings.provider === "openweathermap" && !weatherSettings.weatherApiKey) {
    console.warn("WARNING: WEATHER_API_KEY not set, weather-api will use mock data");
  }
  if (imageSettings.provider === "openai" && !imageSettings.openaiApiKey) {
    console.warn("WARNING: OPENAI_API_KEY not set, image-generator may fail");
  }
  if (imageSettings.provider === "replicate" && !imageSettings.replicateApiKey) {
    console.warn("WARNING: REPLICATE_API_KEY not set, image-generator may fail");
  }
  if (currencySettings.provider === "exchangerate-api" && !currencySettings.apiKey) {
    console.warn("WARNING: EXCHANGE_API_KEY not set, currency-converter will use mock rates");
  }
}

void main();
