import { z } from "zod";
import { POSITIONS } from "../employees/types";

export const certificateTypeInputSchema = z.object({
  name: z.string(),
  englishName: z.string().nullable().optional(),
  requiredForPositions: z.array(z.enum(POSITIONS)),
});

