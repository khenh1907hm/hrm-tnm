import { z } from "zod";
import { POSITIONS } from "./types";

export const employeeInputSchema = z.object({
  code: z.string(), name: z.string(), dob: z.string(), gender: z.enum(["Nam", "Nữ"]), cccd: z.string(),
  phone: z.string(), home: z.string(), address: z.string(), currentAddress: z.string().optional(), position: z.enum(POSITIONS), group: z.number().int().min(1).max(6).nullable(),
  startDate: z.string(), companyStartDate: z.string().nullable().optional(), emergencyContactId: z.string().nullable(), status: z.enum(["active", "on_leave", "resigned"]), endDate: z.string().nullable(),
  mismatchOverrideReason: z.string().optional(), photo: z.string().nullable().optional(), signatureImage: z.string().nullable().optional(),
});
