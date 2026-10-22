import { z } from "zod";
import { MAX_PHOTO_SIZE, PHOTO_MIMES } from "./photo";
import { POSITIONS } from "./types";

/** Ảnh chân dung ghi mới phải là tham chiếu tệp; data URL cũ bị từ chối. */
const photoRefSchema = z.object({ id: z.string().min(1), name: z.string(), mime: z.enum(PHOTO_MIMES), size: z.number().int().positive().max(MAX_PHOTO_SIZE) });

export const employeeInputSchema = z.object({
  code: z.string(), name: z.string(), dob: z.string(), gender: z.enum(["Nam", "Nữ"]), cccd: z.string(),
  phone: z.string(), home: z.string(), address: z.string(), currentAddress: z.string().optional(), position: z.enum(POSITIONS), group: z.number().int().min(1).max(6).nullable(),
  startDate: z.string(), companyStartDate: z.string().nullable().optional(), emergencyContactId: z.string().nullable(), status: z.enum(["active", "on_leave", "resigned"]), endDate: z.string().nullable(),
  mismatchOverrideReason: z.string().optional(), photo: z.string().nullable().optional(), signatureImage: z.string().nullable().optional(),
  startDate: z.string(), emergencyContactId: z.string().nullable(), status: z.enum(["active", "on_leave", "resigned"]), endDate: z.string().nullable(),
  mismatchOverrideReason: z.string().optional(), photo: photoRefSchema.nullable().optional(),
});
