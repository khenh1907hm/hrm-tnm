import { z } from "zod";
const fileSchema = z.object({ id: z.string(), name: z.string(), mime: z.string(), size: z.number().nonnegative() });
const supplementaryFileSchema = z.object({ file: fileSchema, label: z.string().nullable().optional() });
export const certificateInputSchema = z.object({
  type: z.string().min(1), title: z.string().optional().default(""), number: z.string(), issueDate: z.string().nullable(), expiryDate: z.string().nullable(),
  document: fileSchema.nullable(), supplementaryFiles: z.array(supplementaryFileSchema).max(10).optional().default([]),
  safetyGroup: z.number().int().nullable().optional(),
  noExpiry: z.boolean().optional(),
});
