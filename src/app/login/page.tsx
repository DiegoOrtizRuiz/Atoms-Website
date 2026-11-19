import type { Metadata } from "next";
import { BarChart3, Database, ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="grid min-h-screen bg-slate-950 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="relative hidden overflow-hidden border-r border-white/10 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.2),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(16,185,129,0.14),transparent_30%)]" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-cyan-400 text-slate-950">
            <BarChart3 className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">
            Site Pipeline
          </span>
        </div>
        <div className="relative my-auto max-w-xl">
          <p className="mb-5 text-sm font-medium uppercase tracking-[0.24em] text-cyan-300">
            Acquisitions, aligned
          </p>
          <h1 className="text-5xl font-semibold leading-tight tracking-tight">
            One pipeline.
            <br />
            One source of truth.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            Keep operations, weekly review, and permissions connected to the
            same live deal dataset.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              [Database, "Single dataset"],
              [ShieldCheck, "Role secure"],
              [BarChart3, "Meeting ready"],
            ].map(([Icon, label]) => {
              const FeatureIcon = Icon as typeof Database;
              return (
                <div
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                  key={label as string}
                >
                  <FeatureIcon className="mb-3 size-5 text-cyan-300" />
                  <span className="text-sm text-slate-200">
                    {label as string}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="relative text-sm text-slate-500">
          S&amp;P Real Estate · Secure team access
        </p>
      </section>
      <section className="grid place-items-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <div className="mb-5 grid size-10 place-items-center rounded-xl bg-cyan-400 text-slate-950">
              <BarChart3 className="size-5" />
            </div>
            <p className="text-lg font-semibold">Site Pipeline</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
            <div className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                Welcome back
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Sign in with your invited team account.
              </p>
            </div>
            <LoginForm nextPath={next} />
          </div>
          <p className="mt-6 text-center text-xs leading-5 text-slate-500">
            Public sign-up is disabled. Contact an administrator for access.
          </p>
        </div>
      </section>
    </main>
  );
}
