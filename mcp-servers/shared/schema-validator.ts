import { JSONSchema } from "./types";

export function validateInput(
  data: Record<string, unknown>,
  schema: JSONSchema
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (schema.type !== "object") {
    return { valid: true, errors: [] };
  }

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in data) || data[field] === undefined || data[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Validate properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in data)) continue;

      const value = data[key];

      // Type validation
      if (propSchema.type === "string" && typeof value !== "string") {
        errors.push(`Field ${key} must be a string`);
      } else if (propSchema.type === "number" && typeof value !== "number") {
        errors.push(`Field ${key} must be a number`);
      } else if (propSchema.type === "boolean" && typeof value !== "boolean") {
        errors.push(`Field ${key} must be a boolean`);
      }

      // String constraints
      if (propSchema.type === "string" && typeof value === "string") {
        if (propSchema.maxLength && value.length > propSchema.maxLength) {
          errors.push(`Field ${key} exceeds maxLength of ${propSchema.maxLength}`);
        }
        if (propSchema.enum && !propSchema.enum.includes(value)) {
          errors.push(`Field ${key} must be one of: ${propSchema.enum.join(", ")}`);
        }
      }

      // Number constraints
      if (propSchema.type === "number" && typeof value === "number") {
        if (propSchema.minimum !== undefined && value < propSchema.minimum) {
          errors.push(`Field ${key} must be >= ${propSchema.minimum}`);
        }
        if (propSchema.maximum !== undefined && value > propSchema.maximum) {
          errors.push(`Field ${key} must be <= ${propSchema.maximum}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function applyDefaults(
  data: Record<string, unknown>,
  schema: JSONSchema
): Record<string, unknown> {
  const result = { ...data };

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in result) && propSchema.default !== undefined) {
        result[key] = propSchema.default;
      }
    }
  }

  return result;
}
