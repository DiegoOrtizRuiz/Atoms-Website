import type { CurrentUser, UserRole } from "@/lib/auth";

export const rolePermissions: Record<
  UserRole,
  {
    readDeals: string;
    editDeals: string;
    confirmAssumptions: boolean;
    weeklyView: boolean;
    saveSnapshot: boolean;
    admin: boolean;
  }
> = {
  admin: {
    readDeals: "All",
    editDeals: "All",
    confirmAssumptions: true,
    weeklyView: true,
    saveSnapshot: true,
    admin: true,
  },
  leadership: {
    readDeals: "All",
    editDeals: "None",
    confirmAssumptions: false,
    weeklyView: true,
    saveSnapshot: true,
    admin: false,
  },
  acq_lead: {
    readDeals: "All",
    editDeals: "Assigned verticals",
    confirmAssumptions: true,
    weeklyView: true,
    saveSnapshot: false,
    admin: false,
  },
  analyst: {
    readDeals: "All",
    editDeals: "Assigned clients",
    confirmAssumptions: false,
    weeklyView: true,
    saveSnapshot: false,
    admin: false,
  },
  viewer: {
    readDeals: "All",
    editDeals: "None",
    confirmAssumptions: false,
    weeklyView: true,
    saveSnapshot: false,
    admin: false,
  },
};

export function roleCanEditDeals(role: UserRole) {
  return rolePermissions[role].editDeals !== "None";
}

export function roleCanConfirmAssumptions(role: UserRole) {
  return rolePermissions[role].confirmAssumptions;
}

export function describeDealPermissions(user: CurrentUser) {
  const permissions = rolePermissions[user.role];
  const scope =
    permissions.editDeals === "Assigned verticals"
      ? user.verticals
      : permissions.editDeals === "Assigned clients"
        ? user.clients
        : [];
  const scopeLabel =
    permissions.editDeals === "Assigned verticals" ? "verticals" : "clients";
  const read = permissions.readDeals === "All" ? "view all deals" : "view deals";

  if (permissions.editDeals === "All") return `You can ${read} and edit all deals.`;
  if (permissions.editDeals === "None") return `You can ${read}, but you cannot edit deals.`;
  if (!scope.length) {
    return `You can ${read}, but you have no ${scopeLabel} assigned for editing.`;
  }
  const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(scope);
  return permissions.editDeals === "Assigned verticals"
    ? `You can ${read} and edit deals in ${names}.`
    : `You can ${read} and edit ${names} deals.`;
}

export const permissionColumns = [
  { key: "readDeals", label: "Read deals" },
  { key: "editDeals", label: "Edit deals scope" },
  { key: "confirmAssumptions", label: "Confirm assumptions" },
  { key: "weeklyView", label: "Weekly view" },
  { key: "saveSnapshot", label: "Save snapshot" },
  { key: "admin", label: "Admin" },
] as const;
