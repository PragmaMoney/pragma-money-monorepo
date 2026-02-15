import axios from "axios";
import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config, settings } from "../config";

interface GetCurrentArgs {
  location: string;
  units?: string;
}

export async function getCurrentWeather(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[0].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as unknown as GetCurrentArgs;

  try {
    let weatherData: WeatherResult;

    if (settings.provider === "openweathermap" && settings.weatherApiKey) {
      weatherData = await fetchFromOpenWeatherMap(input);
    } else {
      weatherData = await fetchMockWeather(input);
    }

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          ...weatherData,
        }),
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch weather";
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

interface WeatherResult {
  location: string;
  temperature: number;
  feels_like: number;
  unit: string;
  conditions: string;
  humidity: number;
  wind_speed: number;
  timestamp: string;
}

async function fetchFromOpenWeatherMap(input: GetCurrentArgs): Promise<WeatherResult> {
  const units = input.units === "imperial" ? "imperial" : "metric";
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
    input.location
  )}&units=${units}&appid=${settings.weatherApiKey}`;

  const response = await axios.get(url);
  const data = response.data;

  return {
    location: `${data.name}, ${data.sys.country}`,
    temperature: Math.round(data.main.temp * 10) / 10,
    feels_like: Math.round(data.main.feels_like * 10) / 10,
    unit: units === "metric" ? "celsius" : "fahrenheit",
    conditions: data.weather[0].description,
    humidity: data.main.humidity,
    wind_speed: Math.round(data.wind.speed * 10) / 10,
    timestamp: new Date().toISOString(),
  };
}

async function fetchMockWeather(input: GetCurrentArgs): Promise<WeatherResult> {
  // Generate deterministic mock data based on location
  const hash = input.location.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  const temp = 15 + (hash % 20); // 15-35 degrees
  const humidity = 40 + (hash % 40); // 40-80%

  const conditions = [
    "clear sky",
    "few clouds",
    "scattered clouds",
    "light rain",
    "sunny",
  ];

  await new Promise((r) => setTimeout(r, 100)); // Simulate API latency

  return {
    location: input.location,
    temperature: temp,
    feels_like: temp - 2,
    unit: input.units === "imperial" ? "fahrenheit" : "celsius",
    conditions: conditions[hash % conditions.length],
    humidity,
    wind_speed: 5 + (hash % 15),
    timestamp: new Date().toISOString(),
  };
}
