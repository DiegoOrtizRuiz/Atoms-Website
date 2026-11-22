import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { PasswordForm } from "./password-form";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-semibold">Set your password</h1>
        <p className="text-sm text-muted-foreground">Choose a password with at least 12 characters.</p>
        <PasswordForm />
        <form action={signOut}>
          <button className="text-sm underline" type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
