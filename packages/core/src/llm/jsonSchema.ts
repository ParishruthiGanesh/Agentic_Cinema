import { z } from "zod";

/** Keywords Gemini's `responseJsonSchema` accepts. Everything else is stripped. */
const ALLOWED = new Set([
  "type",
  "properties",
  "required",
  "items",
  "prefixItems",
  "enum",
  "description",
  "title",
  "anyOf",
  "oneOf",
  "format",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "additionalProperties",
  "propertyOrdering",
  "nullable",
  "$defs",
  "$ref",
]);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!ALLOWED.has(k)) continue;
    if (k === "properties" || k === "$defs") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = sanitize(pv);
      out[k] = props;
    } else {
      out[k] = sanitize(v);
    }
  }
  return out;
}

/** Convert a zod schema into a Gemini-compatible JSON schema. */
export function toGeminiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-7", io: "output", unrepresentable: "any" });
  return sanitize(raw) as Record<string, unknown>;
}
