import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type NotificationCategory =
  | "requisicao"
  | "emprestimo"
  | "devolucao"
  | "chat"
  | "sistema"
  | "auditoria";

export type NotificationRow = {
  id: string;
  user_id: string;
  category: NotificationCategory;
  event_type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  sala_id: string | null;
  actor_id: string | null;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
};

export type ChatAlert = {
  id: string;                // "chat:<conversation_id>"
  conversation_id: string;
  sender_id: string;
  sender_nome: string;
  preview: string;
  created_at: string;
  unread_count: number;
};

type Ctx = {
  notifications: NotificationRow[];
  chatAlerts: ChatAlert[];
  totalCount: number;                            // unread (sino vermelho)
  activeCount: number;                           // não fechadas
  perSalaCount: Record<string, number>;          // unread por sala
  countByCategory: Record<NotificationCategory, number>;
  isRead: (id: string) => boolean;
  isDismissed: (id: string) => boolean;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  dismiss: (id: string) => void;
  restore: (id: string) => void;
  markAllRead: () => void;
  dismissAll: () => void;
  soundEnabled: boolean;
  toggleSound: () => void;
  refresh: () => Promise<void>;
};

const NotificationsContext = createContext<Ctx | undefined>(undefined);

const SOUND_KEY = "notif_sound_enabled";

function playBeep(kind: "info" | "warn" = "info") {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = kind === "warn" ? 660 : 880;
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {}
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [chatAlerts, setChatAlerts] = useState<ChatAlert[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(SOUND_KEY) !== "0"; } catch { return true; }
  });
  const initialLoadedRef = useRef(false);

  const toggleSound = useCallback(() => {
    setSoundEnabled((s) => {
      const next = !s;
      try { localStorage.setItem(SOUND_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!user) { setNotifications([]); setChatAlerts([]); return; }
    // 1) Notificações persistidas
    const { data: rows } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500);
    setNotifications((rows ?? []) as NotificationRow[]);

    // 2) Chat (não persistido — derivado das conversas)
    try {
      const { data: convs } = await supabase.rpc("list_my_conversations");
      const unread = (convs ?? []).filter((c: any) => (c.unread_count ?? 0) > 0);
      const senderIds = [...new Set(unread.map((c: any) => c.last_sender_id).filter(Boolean))];
      let nameMap = new Map<string, string>();
      if (senderIds.length > 0) {
        const { data: ps } = await supabase.from("profiles").select("id, nome").in("id", senderIds);
        nameMap = new Map((ps ?? []).map((p: any) => [p.id, p.nome]));
      }
      setChatAlerts(unread.map((c: any) => ({
        id: `chat:${c.id}`,
        conversation_id: c.id,
        sender_id: c.last_sender_id ?? "",
        sender_nome: c.last_sender_id ? (nameMap.get(c.last_sender_id) ?? "Usuário") : (c.title ?? "Conversa"),
        preview: c.last_message_body ?? "Nova mensagem",
        created_at: c.last_message_at ?? new Date().toISOString(),
        unread_count: c.unread_count ?? 0,
      })));
    } catch { /* noop */ }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    initialLoadedRef.current = false;
    refresh().then(() => { initialLoadedRef.current = true; });
  }, [user, refresh]);

  // Realtime: notifications (insert/update) + chat
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`notifs-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as NotificationRow;
          setNotifications((cur) => {
            if (cur.some((n) => n.id === row.id)) return cur;
            return [row, ...cur].slice(0, 500);
          });
          if (initialLoadedRef.current) {
            if (soundEnabled) playBeep(row.category === "requisicao" || row.event_type.endsWith(".rejeitado") ? "warn" : "info");
            toast(row.title, {
              description: row.body ?? undefined,
              duration: 9000,
              action: row.link ? { label: "Abrir", onClick: () => {
                supabase.from("notifications").update({ is_read: true }).eq("id", row.id);
                navigate(row.link!);
              } } : undefined,
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as NotificationRow;
          setNotifications((cur) => cur.map((n) => (n.id === row.id ? row : n)));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const row: any = payload.new;
          if (row.sender_id === user.id) return;
          if (typeof window !== "undefined") {
            const p = window.location.pathname;
            const url = new URL(window.location.href);
            const c = url.searchParams.get("c");
            if (p.startsWith("/app/chat") && c === row.conversation_id) {
              await refresh();
              return;
            }
          }
          const { data: prof } = await supabase.from("profiles").select("nome").eq("id", row.sender_id).maybeSingle();
          const openConv = () => {
            const onChatPage = typeof window !== "undefined" && window.location.pathname.startsWith("/app/chat");
            if (onChatPage) navigate(`/app/chat?c=${row.conversation_id}`);
            else window.dispatchEvent(new CustomEvent("floating-chat:open", { detail: { conversationId: row.conversation_id } }));
          };
          if (soundEnabled) playBeep("info");
          toast(`💬 ${prof?.nome ?? "Nova mensagem"}`, {
            description: row.body ?? (row.attachment_name ? `📎 ${row.attachment_name}` : "Nova mensagem"),
            duration: 9000,
            action: { label: "Abrir", onClick: openConv },
          });
          await refresh();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, soundEnabled, refresh, navigate]);

  // Mutations
  const update = useCallback(async (id: string, patch: Partial<Pick<NotificationRow, "is_read" | "is_dismissed">>) => {
    setNotifications((cur) => cur.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    await supabase.from("notifications").update(patch).eq("id", id);
  }, []);

  const markRead = useCallback((id: string) => { void update(id, { is_read: true }); }, [update]);
  const markUnread = useCallback((id: string) => { void update(id, { is_read: false }); }, [update]);
  const dismiss = useCallback((id: string) => { void update(id, { is_read: true, is_dismissed: true }); }, [update]);
  const restore = useCallback((id: string) => { void update(id, { is_dismissed: false }); }, [update]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    setNotifications((cur) => cur.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
  }, [user]);

  const dismissAll = useCallback(async () => {
    if (!user) return;
    setNotifications((cur) => cur.map((n) => ({ ...n, is_read: true, is_dismissed: true })));
    await supabase.from("notifications").update({ is_read: true, is_dismissed: true }).eq("user_id", user.id).eq("is_dismissed", false);
  }, [user]);

  const isRead = useCallback((id: string) => {
    const n = notifications.find((x) => x.id === id);
    return n ? n.is_read : false;
  }, [notifications]);
  const isDismissed = useCallback((id: string) => {
    const n = notifications.find((x) => x.id === id);
    return n ? n.is_dismissed : false;
  }, [notifications]);

  const totalCount = useMemo(() => {
    const u = notifications.filter((n) => !n.is_read && !n.is_dismissed).length;
    const c = chatAlerts.reduce((s, x) => s + x.unread_count, 0);
    return u + c;
  }, [notifications, chatAlerts]);

  const activeCount = useMemo(
    () => notifications.filter((n) => !n.is_dismissed).length,
    [notifications]
  );

  const perSalaCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of notifications) {
      if (n.is_read || n.is_dismissed || !n.sala_id) continue;
      map[n.sala_id] = (map[n.sala_id] ?? 0) + 1;
    }
    return map;
  }, [notifications]);

  const countByCategory = useMemo(() => {
    const cats: NotificationCategory[] = ["requisicao", "emprestimo", "devolucao", "chat", "sistema", "auditoria"];
    const map = Object.fromEntries(cats.map((c) => [c, 0])) as Record<NotificationCategory, number>;
    for (const n of notifications) {
      if (n.is_read || n.is_dismissed) continue;
      map[n.category] = (map[n.category] ?? 0) + 1;
    }
    map.chat += chatAlerts.length;
    return map;
  }, [notifications, chatAlerts]);

  const value: Ctx = {
    notifications,
    chatAlerts,
    totalCount,
    activeCount,
    perSalaCount,
    countByCategory,
    isRead, isDismissed,
    markRead, markUnread, dismiss, restore,
    markAllRead, dismissAll,
    soundEnabled, toggleSound,
    refresh,
  };

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications deve ser usado dentro de NotificationsProvider");
  return ctx;
}
