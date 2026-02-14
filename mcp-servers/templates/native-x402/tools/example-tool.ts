import { ToolHandler, MCPContent } from "../../../shared/types";

interface ExampleToolInput {
  message: string;
}

/**
 * Example tool handler for Native x402 MCP service.
 *
 * This is a simple echo tool that demonstrates the handler structure.
 * Replace this with your actual tool implementation.
 */
export const exampleTool: ToolHandler = async (
  args: Record<string, unknown>
): Promise<MCPContent[]> => {
  const input = args as ExampleToolInput;

  // Validate input
  if (!input.message || typeof input.message !== "string") {
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: "Message is required and must be a string",
        }),
      },
    ];
  }

  // Process the request (replace with your actual logic)
  const result = {
    success: true,
    echo: input.message,
    timestamp: new Date().toISOString(),
    note: "This is a native x402 service - payments go directly to the owner",
  };

  return [
    {
      type: "text",
      text: JSON.stringify(result),
    },
  ];
};
