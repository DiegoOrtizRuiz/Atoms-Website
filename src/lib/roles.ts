import type { Database } from "@/lib/database.types";

export const userRoles = [
  "admin",
  "leadership",
  "acq_lead",
  "analyst",
  "viewer",
] as const satisfies readonly Database["public"]["Enums"]["user_role"][];
