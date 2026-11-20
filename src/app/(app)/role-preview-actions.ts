"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireUser, userRoles } from "@/lib/auth";

const roleSchema = z.enum(userRoles);

export async function setViewAsRole(value: string) {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("Only administrators can preview another role.");
  }
  const role = roleSchema.parse(value);
  const cookieStore = await cookies();

  if (role === "admin") {
    cookieStore.delete("view_as");
  } else {
    cookieStore.set("view_as", role, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  }

  revalidatePath("/", "layout");
  return role;
}
