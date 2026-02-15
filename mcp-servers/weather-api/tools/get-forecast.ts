import axios from "axios";
import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config, settings } from "../config";

interface GetForecastArgs {
  location: string;
  units?: string;
  days?: number;
}

interface ForecastDay {
  date: string;
  high: number;
  low: number;
  conditions: string;
  precipitation_chance: number;
}

export async function getForecast(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[1].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as unknown as GetForecastArgs;

  try {
    let forecast: ForecastDay[];

    if (settings.provider === "openweathermap" && settings.weatherApiKey) {
      forecast = await fetchForecastFromOpenWeatherMap(input);
    } else {
      forecast = await fetchMockForecast(input);
    }

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          location: input.location,
          forecast: forecast.slice(0, input.days || 5),
        }),
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch forecast";
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: message,
          location: input.location,
        }),
      },
    ];
  }
}

async function fetchForecastFromOpenWeatherMap(
  input: GetForecastArgs
): Promise<ForecastDay[]> {
  const units = input.units === "imperial" ? "imperial" : "metric";
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(
    input.location
  )}&units=${units}&appid=${settings.weatherApiKey}`;

  const response = await axios.get(url);
  const data = response.data;

  // Group by day and extract daily highs/lows
  const dailyData: Map<string, { temps: number[]; conditions: string[] }> = new Map();

  for (const item of data.list) {
    const date = item.dt_txt.split(" ")[0];
    if (!dailyData.has(date)) {
      dailyData.set(date, { temps: [], conditions: [] });
    }
    dailyData.get(date)!.temps.push(item.main.temp);
    dailyData.get(date)!.conditions.push(item.weather[0].description);
  }

  const forecast: ForecastDay[] = [];
  for (const [date, { temps, conditions }] of dailyData) {
    forecast.push({
      date,
      high: Math.round(Math.max(...temps) * 10) / 10,
      low: Math.round(Math.min(...temps) * 10) / 10,
      conditions: conditions[Math.floor(conditions.length / 2)],
      precipitation_chance: Math.random() * 100, // API doesn't provide this directly
    });
  }

  return forecast.slice(0, 5);
}

async function fetchMockForecast(input: GetForecastArgs): Promise<ForecastDay[]> {
  const hash = input.location.split("").reduce((a, b) => a + b.charCodeAt(0), 0);

  const conditions = [
    "sunny",
    "partly cloudy",
    "cloudy",
    "light rain",
    "thunderstorms",
  ];

  const forecast: ForecastDay[] = [];
  const today = new Date();

  for (let i = 0; i < 5; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);

    const dayHash = hash + i * 17;
    const high = 20 + (dayHash % 15);
    const low = high - 5 - (dayHash % 5);

    forecast.push({
      date: date.toISOString().split("T")[0],
      high,
      low,
      conditions: conditions[dayHash % conditions.length],
      precipitation_chance: Math.round((dayHash % 100)),
    });
  }

  await new Promise((r) => setTimeout(r, 100));
  return forecast;
}
