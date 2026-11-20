"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { CurrentUser, UserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

export type PresenceMember = {
  user_id: string;
  full_name: string;
  role: UserRole;
  page: string;
  since: string;
};

const PresenceUserContext = createContext<CurrentUser | null>(null);
const PresenceMembersContext = createContext<PresenceMember[]>([]);

function PresenceController({ children }: { children?: ReactNode }) {
  const page = usePathname();
  const members = usePresence(page);

  return createElement(
    PresenceMembersContext.Provider,
    { value: members },
    children,
  );
}

export function PresenceProvider({
  children,
  user,
}: {
  children: ReactNode;
  user: CurrentUser;
}) {
  return createElement(
    PresenceUserContext.Provider,
    { value: user },
    createElement(PresenceController, null, children),
  );
}

export function usePresence(page: string) {
  const user = useContext(PresenceUserContext);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const since = useRef(new Date().toISOString());

  useEffect(() => {
    if (!user) return;

    const supabase = createClient();
    const channel = supabase
      .channel("app-presence", {
        config: { presence: { key: user.id } },
      })
      .on("presence", { event: "sync" }, () => {
        const uniqueMembers = new Map<string, PresenceMember>();
        Object.values(channel.presenceState<PresenceMember>())
          .flat()
          .forEach((member) => uniqueMembers.set(member.user_id, member));
        setMembers([...uniqueMembers.values()]);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({
            user_id: user.id,
            full_name: user.fullName,
            role: user.role,
            page,
            since: since.current,
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [page, user]);

  if (!user) {
    throw new Error("usePresence must be used inside PresenceProvider.");
  }

  return members;
}

export function usePresenceMembers() {
  return useContext(PresenceMembersContext);
}
