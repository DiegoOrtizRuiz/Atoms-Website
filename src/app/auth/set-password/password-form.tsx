"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPassword, type PasswordState } from "./actions";

export function PasswordForm() {
  const initialState: PasswordState = {};
  const [state, action, pending] = useActionState(setPassword, initialState);
  return (
    <form action={action} className="space-y-4">
      <label className="grid gap-1 text-sm font-medium">New password
        <Input autoComplete="new-password" minLength={12} name="password" required type="password" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Confirm password
        <Input autoComplete="new-password" minLength={12} name="confirm" required type="password" />
      </label>
      {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
      <Button disabled={pending} type="submit">{pending ? "Saving…" : "Set password"}</Button>
    </form>
  );
}
