"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { supabaseConfig } from "@/lib/supabase/config";

export function CompleteAuth({ next }: { next: string }) {
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!accessToken || !refreshToken) {
      setError("This authentication link is invalid or has expired. Request a new link.");
      return;
    }

    const supabase = createBrowserClient<Database>(supabaseConfig.url, supabaseConfig.anonKey, {
      isSingleton: false,
      auth: { detectSessionInUrl: false },
    });
    void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError("Unable to complete sign-in. Request a new link.");
          console.error("Unable to establish the email session.", sessionError);
          return;
        }
        window.location.replace(next);
      }).catch((sessionError: unknown) => {
        console.error("Unable to establish the email session.", sessionError);
        setError("Unable to complete sign-in. Request a new link.");
      });
  }, [next]);

  return <main className="grid min-h-screen place-items-center p-6">
    {error ? <div role="alert">{error} <a className="underline" href="/login">Sign in</a></div> : <p>Completing sign-in…</p>}
  </main>;
}
