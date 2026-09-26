import { z } from "zod";

export const apiErrorCodeSchema = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);

export const ingestionSafetyErrorDetailsSchema = z
  .object({
    kind: z.literal("ingestion_mutation_safety"),
    safeToRun: z.boolean(),
    checkedAt: z.string().datetime(),
    reason: z.string().min(1),
    message: z.string().min(1),
    activeJobCount: z.number().int().nonnegative(),
    staleProcessingJobCount: z.number().int().nonnegative(),
    activeJobs: z.array(
      z
        .object({
          id: z.string(),
          documentId: z.string().nullable(),
          status: z.string().nullable(),
          stage: z.string().nullable(),
          lockedAt: z.string().nullable(),
          updatedAt: z.string().nullable(),
          errorMessage: z.string().nullable(),
          attemptCount: z.number().nullable(),
          maxAttempts: z.number().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const rateLimitErrorDetailsSchema = z
  .object({
    kind: z.literal("rate_limit"),
    retryAfterSeconds: z.number().finite().nonnegative(),
    resetAt: z.string().datetime(),
  })
  .strict();

export const apiErrorDetailsSchema = z.discriminatedUnion("kind", [
  ingestionSafetyErrorDetailsSchema,
  rateLimitErrorDetailsSchema,
]);

/** Canonical public API error envelope. Keep this strict so server-only details cannot leak. */
export const apiErrorPayloadSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    code: apiErrorCodeSchema,
    requestId: z.string().min(1).optional(),
    details: apiErrorDetailsSchema.optional(),
  })
  .strict();

export const apiStreamErrorPayloadSchema = apiErrorPayloadSchema
  .extend({ status: z.number().int().min(400).max(599) })
  .strict();

export type ApiErrorPayload = z.infer<typeof apiErrorPayloadSchema>;
export type ApiStreamErrorPayload = z.infer<typeof apiStreamErrorPayloadSchema>;
