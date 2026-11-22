"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtOrDash } from "@/lib/format";
import { permissionColumns, rolePermissions } from "@/lib/permissions";
import type { CurrentUser, UserRole } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { userRoles } from "@/lib/roles";
import { inviteAdminUser, updateAdminProfile } from "./actions";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Usage = Database["public"]["Views"]["v_user_usage"]["Row"];

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid max-h-36 grid-cols-2 gap-2 overflow-auto rounded-md border p-2">
        {options.map((option) => (
          <label className="flex items-center gap-2 text-sm" key={option}>
            <input
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option),
                )
              }
              type="checkbox"
            />
            <span className="truncate">{option}</span>
          </label>
        ))}
        {!options.length && <span className="text-sm text-muted-foreground">No options available.</span>}
      </div>
    </fieldset>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: UserRole;
  onChange: (value: UserRole) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      Role
      <select
        className="h-9 rounded-lg border border-input bg-background px-2.5 font-normal"
        onChange={(event) => {
          const next = event.target.value;
          if (userRoles.includes(next as UserRole)) onChange(next as UserRole);
        }}
        value={value}
      >
        {userRoles.map((role) => (
          <option key={role} value={role}>{role.replaceAll("_", " ")}</option>
        ))}
      </select>
    </label>
  );
}

function PermissionMatrix() {
  return (
    <Card>
      <CardHeader><CardTitle>Permission matrix</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 font-medium">Role</th>
                {permissionColumns.map((column) => <th className="p-2 font-medium" key={column.key}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {userRoles.map((role) => (
                <tr className="border-b last:border-0" key={role}>
                  <td className="p-2 font-medium capitalize">{role.replaceAll("_", " ")}</td>
                  {permissionColumns.map((column) => {
                    const value = rolePermissions[role][column.key];
                    return <td className="p-2" key={column.key}>{typeof value === "boolean" ? (value ? "Yes" : "No") : value}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function UsersPanel({
  clients,
  profiles,
  user,
  usage,
  verticals,
}: {
  clients: string[];
  profiles: Profile[];
  user: CurrentUser;
  usage: Usage[];
  verticals: string[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editing, setEditing] = useState<Profile | null>(null);
  const [role, setRole] = useState<UserRole>("viewer");
  const [selectedVerticals, setSelectedVerticals] = useState<string[]>([]);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
  const [inviteVerticals, setInviteVerticals] = useState<string[]>([]);
  const [inviteClients, setInviteClients] = useState<string[]>([]);
  const [inviteError, setInviteError] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMode, setInviteMode] = useState<"temporary" | "email">("temporary");
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const usageById = new Map(usage.flatMap((item) => item.user_id ? [[item.user_id, item] as const] : []));
  const filtered = profiles.filter((profile) => {
    const matchesText =
      !search ||
      profile.full_name.toLowerCase().includes(search.toLowerCase()) ||
      profile.email.toLowerCase().includes(search.toLowerCase());
    return matchesText && (roleFilter === "all" || profile.role === roleFilter);
  });

  function beginEdit(profile: Profile) {
    setEditing(profile);
    setRole(profile.role);
    setSelectedVerticals(profile.verticals);
    setSelectedClients(profile.clients);
    setActive(profile.active);
    setEditError("");
  }

  async function saveProfile() {
    if (!editing) return;
    setEditBusy(true);
    setEditError("");
    try {
      await updateAdminProfile({
        id: editing.id,
        role,
        verticals: selectedVerticals,
        clients: selectedClients,
        active,
      });
      setEditing(null);
      router.refresh();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Unable to update this profile.");
    } finally {
      setEditBusy(false);
    }
  }

  async function invite() {
    setInviteBusy(true);
    setInviteError("");
    setTemporaryPassword(null);
    try {
      const result = await inviteAdminUser({
        email,
        fullName,
        role: inviteRole,
        verticals: inviteVerticals,
        clients: inviteClients,
        mode: inviteMode,
      });
      setTemporaryPassword(result.temporaryPassword);
      setEmail("");
      setFullName("");
      if (!result.temporaryPassword) setInviteOpen(false);
      router.refresh();
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Unable to invite this user.");
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Users &amp; permissions</CardTitle>
          <Button onClick={() => { setInviteOpen(true); setInviteError(""); setTemporaryPassword(null); setInviteMode("temporary"); }}>
            Invite user
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Search users" onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" value={search} />
            <select
              aria-label="Filter by role"
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              onChange={(event) => setRoleFilter(event.target.value)}
              value={roleFilter}
            >
              <option value="all">All roles</option>
              {userRoles.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead><tr className="border-b">
                {["Name", "Email", "Role", "Verticals", "Clients", "Active", "Last login", "Logins 7d", "Edits 7d", ""].map((heading) => <th className="p-2 font-medium" key={heading}>{heading}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map((profile) => {
                  const stats = usageById.get(profile.id);
                  return (
                    <tr className="border-b last:border-0" key={profile.id}>
                      <td className="p-2 font-medium">{profile.full_name}</td>
                      <td className="p-2">{profile.email}</td>
                      <td className="p-2"><Badge variant="outline" className="capitalize">{profile.role.replaceAll("_", " ")}</Badge></td>
                      <td className="max-w-40 truncate p-2">{profile.verticals.join(", ") || "—"}</td>
                      <td className="max-w-40 truncate p-2">{profile.clients.join(", ") || "—"}</td>
                      <td className="p-2">{profile.active ? "Yes" : "No"}</td>
                      <td className="p-2">{fmtDate(stats?.last_login)}</td>
                      <td className="p-2">{stats?.logins_7d ?? 0}</td>
                      <td className="p-2">{stats?.edits_7d ?? 0}</td>
                      <td className="p-2"><Button onClick={() => beginEdit(profile)} size="sm" variant="outline">Edit</Button></td>
                    </tr>
                  );
                })}
                {!filtered.length && <tr><td className="p-4 text-muted-foreground" colSpan={10}>No users match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <PermissionMatrix />

      <Dialog onOpenChange={(open) => { if (!open) setEditing(null); }} open={Boolean(editing)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit user permissions</DialogTitle>
            <DialogDescription>{editing?.full_name} · {editing?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <RoleSelect onChange={setRole} value={role} />
            <MultiSelect label="Verticals" onChange={setSelectedVerticals} options={verticals} selected={selectedVerticals} />
            <MultiSelect label="Clients" onChange={setSelectedClients} options={clients} selected={selectedClients} />
            <label className="flex items-center gap-2 text-sm">
              <input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />
              Active account
            </label>
            {editing?.id === user.id && <p className="text-xs text-muted-foreground">Your own role cannot be changed and your own account cannot be deactivated.</p>}
            {editError && <p className="text-sm text-destructive" role="alert">{editError}</p>}
          </div>
          <DialogFooter>
            <Button disabled={editBusy} onClick={saveProfile}>{editBusy ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { setInviteOpen(open); if (!open) setTemporaryPassword(null); }} open={inviteOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>Create a user with a temporary password or send an email invitation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!temporaryPassword && <fieldset className="space-y-2 text-sm">
              <legend className="font-medium">Account setup</legend>
              <label className="flex items-center gap-2"><input checked={inviteMode === "temporary"} onChange={() => setInviteMode("temporary")} name="invite-mode" type="radio" /> Create with temporary password</label>
              <label className="flex items-center gap-2"><input checked={inviteMode === "email"} onChange={() => setInviteMode("email")} name="invite-mode" type="radio" /> Send email invite</label>
            </fieldset>}
            <label className="grid gap-1 text-sm font-medium">Full name<Input autoComplete="name" onChange={(event) => setFullName(event.target.value)} value={fullName} /></label>
            <label className="grid gap-1 text-sm font-medium">Email<Input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label>
            <RoleSelect onChange={setInviteRole} value={inviteRole} />
            <MultiSelect label="Verticals" onChange={setInviteVerticals} options={verticals} selected={inviteVerticals} />
            <MultiSelect label="Clients" onChange={setInviteClients} options={clients} selected={inviteClients} />
            {inviteError && <p className="text-sm text-destructive" role="alert">{inviteError}</p>}
            {temporaryPassword && <div className="space-y-1 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">Show this temporary password once. It will not be available again.</p>
              <code className="select-all break-all">{temporaryPassword}</code>
              <Button onClick={async () => {
                try {
                  await navigator.clipboard.writeText(temporaryPassword);
                } catch {
                  setInviteError("Unable to copy the password. Select and copy it manually.");
                }
              }} size="sm" type="button" variant="outline">Copy password</Button>
            </div>}
          </div>
          <DialogFooter>
            <Button disabled={inviteBusy || Boolean(temporaryPassword)} onClick={invite}>{inviteBusy ? "Creating…" : inviteMode === "temporary" ? "Create user" : "Send invite"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="sr-only">Signed in as {fmtOrDash(user.fullName)}.</p>
    </div>
  );
}
