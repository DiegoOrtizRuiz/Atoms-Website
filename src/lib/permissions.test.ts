import { describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/auth";
import { describeDealPermissions } from "@/lib/permissions";

const user: CurrentUser = {
  id: "1",
  email: "example@example.test",
  fullName: "Example",
  role: "viewer",
  clients: [],
  verticals: [],
};

describe("describeDealPermissions", () => {
  it("describes read-only and unrestricted access", () => {
    expect(describeDealPermissions(user)).toBe("You can view all deals, but you cannot edit deals.");
    expect(describeDealPermissions({ ...user, role: "admin" })).toBe("You can view all deals and edit all deals.");
  });

  it("uses the user's assigned clients and verticals", () => {
    expect(describeDealPermissions({ ...user, role: "analyst", clients: ["Client A", "Client B"] }))
      .toBe("You can view all deals and edit Client A and Client B deals.");
    expect(describeDealPermissions({ ...user, role: "acq_lead", verticals: ["Food"] }))
      .toBe("You can view all deals and edit deals in Food.");
    expect(describeDealPermissions({ ...user, role: "analyst" }))
      .toBe("You can view all deals, but you have no clients assigned for editing.");
  });
});
