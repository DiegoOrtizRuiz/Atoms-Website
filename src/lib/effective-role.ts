import "server-only";

import { cookies } from "next/headers";
import { userRoles, type CurrentUser, type UserRole } from "@/lib/auth";

export async function effectiveRole(user: CurrentUser): Promise<UserRole> {
  if (user.role !== "admin") return user.role;

  const previewRole = (await cookies()).get("view_as")?.value;
  return userRoles.find((role) => role === previewRole) ?? user.role;
}
