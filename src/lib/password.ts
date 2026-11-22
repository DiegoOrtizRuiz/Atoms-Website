import { z } from "zod";

export const passwordSchema = z.object({
  password: z.string().min(12, "Password must be at least 12 characters."),
  confirm: z.string(),
}).refine((value) => value.password === value.confirm, {
  path: ["confirm"],
  message: "Passwords do not match.",
});
