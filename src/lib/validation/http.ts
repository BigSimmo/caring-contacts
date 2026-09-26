import { z } from "zod";
import { PublicApiError } from "@/lib/http";

export function validationError(message: string, code = "invalid_request") {
  return new PublicApiError(message, 400, { code });
}

export function parseSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  message: string,
  code = "invalid_request",
): z.infer<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(message, code);
  return parsed.data;
}
