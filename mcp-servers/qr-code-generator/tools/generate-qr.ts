import QRCode from "qrcode";
import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config } from "../config";

interface GenerateQRArgs {
  data: string;
  size?: number;
  format?: "png" | "svg" | "base64";
  errorCorrection?: "L" | "M" | "Q" | "H";
}

export async function generateQR(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[0].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as GenerateQRArgs;

  try {
    const options: QRCode.QRCodeToDataURLOptions = {
      width: input.size || 300,
      errorCorrectionLevel: input.errorCorrection || "M",
      margin: 2,
    };

    let qrData: string;
    let mimeType: string;

    switch (input.format) {
      case "svg":
        qrData = await QRCode.toString(input.data, {
          ...options,
          type: "svg",
        });
        mimeType = "image/svg+xml";
        break;
      case "png":
        qrData = await QRCode.toDataURL(input.data, options);
        mimeType = "image/png";
        break;
      case "base64":
      default:
        qrData = await QRCode.toDataURL(input.data, options);
        mimeType = "image/png";
        break;
    }

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          data: input.data,
          format: input.format || "base64",
          size: input.size || 300,
          qrData: qrData,
        }),
      },
    ];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate QR code";
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: message,
          data: input.data,
        }),
      },
    ];
  }
}
