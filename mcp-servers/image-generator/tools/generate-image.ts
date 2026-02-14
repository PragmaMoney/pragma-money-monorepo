import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config, settings } from "../config";

interface GenerateImageArgs {
  prompt: string;
  size?: string;
  style?: string;
}

export async function generateImage(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[0].inputSchema;

  // Validate input
  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  // Apply defaults
  const input = applyDefaults(args, schema) as GenerateImageArgs;

  const startTime = Date.now();

  try {
    let imageUrl: string;

    switch (settings.provider) {
      case "openai":
        imageUrl = await generateWithOpenAI(input);
        break;
      case "replicate":
        imageUrl = await generateWithReplicate(input);
        break;
      case "mock":
      default:
        imageUrl = await generateMock(input);
    }

    const generationTime = Date.now() - startTime;

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          image_url: imageUrl,
          prompt_used: input.prompt,
          generation_time_ms: generationTime,
          size: input.size,
          style: input.style,
        }),
      },
      {
        type: "image",
        data: imageUrl,
        mimeType: "image/png",
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: message,
          prompt_used: input.prompt,
        }),
      },
    ];
  }
}

async function generateWithOpenAI(input: GenerateImageArgs): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: settings.openaiApiKey });

  // Map size to OpenAI format
  const sizeMap: Record<string, "256x256" | "512x512" | "1024x1024"> = {
    "256x256": "256x256",
    "512x512": "512x512",
    "1024x1024": "1024x1024",
  };

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: `${input.prompt} (style: ${input.style})`,
    n: 1,
    size: sizeMap[input.size || "512x512"],
  });

  return response.data[0].url || "";
}

async function generateWithReplicate(input: GenerateImageArgs): Promise<string> {
  const Replicate = (await import("replicate")).default;
  const replicate = new Replicate({ auth: settings.replicateApiKey });

  // Use Stable Diffusion XL
  const output = await replicate.run(
    "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
    {
      input: {
        prompt: `${input.prompt}, ${input.style} style`,
        width: parseInt(input.size?.split("x")[0] || "512"),
        height: parseInt(input.size?.split("x")[1] || "512"),
        num_outputs: 1,
      },
    }
  );

  // Replicate returns array of URLs
  const urls = output as string[];
  return urls[0] || "";
}

async function generateMock(input: GenerateImageArgs): Promise<string> {
  // Mock implementation for testing without API keys
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Return a placeholder image URL
  const width = input.size?.split("x")[0] || "512";
  const height = input.size?.split("x")[1] || "512";

  return `https://picsum.photos/${width}/${height}?random=${Date.now()}`;
}
