export type ContentType =
  | "application/json"      // Structured JSON data
  | "text/plain"            // Plain text
  | "text/markdown"         // Markdown (render as HTML)
  | "image/png"             // PNG image
  | "image/jpeg"            // JPEG image
  | "image/svg+xml"         // SVG image
  | "application/pdf"       // PDF document
  | "text/html"             // HTML content
  | "application/zip"       // Downloadable file
  | "text/uri-list";        // List of URIs/links

export interface SchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
}

export interface ServiceSchema {
  input?: {
    type: "object";
    properties?: Record<string, SchemaProperty>;
    required?: string[];
    description?: string;
  };
  output?: {
    contentType: ContentType;
    schema?: {
      type: string;
      properties?: Record<string, SchemaProperty>;
    };
    description?: string;
  };
}

export interface MCPContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}
