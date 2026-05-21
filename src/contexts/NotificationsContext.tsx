import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type PendingRequisicao = {
  id: string;
  sala_id: string;
  sala_nome: string;
  usuario_nome: string;
  created_at: string;
};

export type PendingEmprestimo = {
  id: string;
  status: "pendente" | "aprovado";
  sala_origem_id: string;
  sala_destino_id: string;
  sala_origem_nome: string;
  sala_destino_nome: string;
  solicitante_nome: string;
  created_at: string;
};

export type ChatAlert = {
  id: string;                // conversation id (agrupado)
  conversation_id: string;
  sender_id: string;
  sender_nome: string;
  preview: string;
  created_at: string;
  unread_count: number;
};

type Ctx = {
  requisicoes: PendingRequisicao[];
  emprestimosPendentes: PendingEmprestimo[];
  emprestimosAprovados: PendingEmprestimo[];
  chatAlerts: ChatAlert[];
  totalCount: number;
  activeCount: number;
  perSalaCount: Record<string, number>;
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
const READ_KEY = "notif_read_ids";
const DISMISS_KEY = "notif_dismissed_ids";

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function saveSet(key: string, s: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch {}
}

// pequeno beep gerado via WebAudio (sem precisar de arquivo)
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
  const { user, role, profile } = useAuth();
  const navigate = useNavigate();
  const [requisicoes, setRequisicoes] = useState<PendingRequisicao[]>([]);
  const [emprestimosPendentes, setEmprestimosPendentes] = useState<PendingEmprestimo[]>([]);
  const [emprestimosAprovados, setEmprestimosAprovados] = useState<PendingEmprestimo[]>([]);
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

  // Carrega snapshot inicial conforme papel
  const refresh = useCallback(async () => {
    if (!user || !role) {
      setRequisicoes([]); setEmprestimosPendentes([]); setEmprestimosAprovados([]);
      return;
    }

    if (role === "master") {
      let reqsMapped: PendingRequisicao[] = [];
      const { data: rs } = await supabase
        .from("solicitacoes")
        .select("id, sala_id, usuario_id, created_at")
        .eq("status", "pendente")
        .order("created_at", { ascending: false });
      if (rs?.length) {
        const salaIds = [...new Set(rs.map((x) => x.sala_id))];
        const userIds = [...new Set(rs.map((x) => x.usuario_id))];
        const [{ data: salas }, { data: profs }] = await Promise.all([
          supabase.from("salas").select("id, nome").in("id", salaIds),
          supabase.from("profiles").select("id, nome").in("id", userIds),
        ]);
        const sm = new Map((salas ?? []).map((s) => [s.id, s.nome]));
        const um = new Map((profs ?? []).map((p) => [p.id, p.nome]));
        reqsMapped = rs.map((r) => ({
          id: r.id,
          sala_id: r.sala_id,
          sala_nome: sm.get(r.sala_id) ?? "—",
          usuario_nome: um.get(r.usuario_id) ?? "—",
          created_at: r.created_at,
        }));
      }
      setRequisicoes(reqsMapped);

      // Empréstimos: pendentes e aprovados (aguardando arquivamento)
      const { data: emps } = await supabase
        .from("emprestimos")
        .select("id, status, sala_origem_id, sala_destino_id, solicitante_id, created_at")
        .in("status", ["pendente", "aprovado"])
        .order("created_at", { ascending: false });

      let pend: PendingEmprestimo[] = [];
      let apr: PendingEmprestimo[] = [];
      if (emps?.length) {
        const salaIds = [...new Set(emps.flatMap((e) => [e.sala_origem_id, e.sala_destino_id]))];
        const userIds = [...new Set(emps.map((e) => e.solicitante_id))];
        const [{ data: salas }, { data: profs }] = await Promise.all([
          supabase.from("salas").select("id, nome").in("id", salaIds),
          supabase.from("profiles").select("id, nome").in("id", userIds),
        ]);
        const sm = new Map((salas ?? []).map((s) => [s.id, s.nome]));
        const um = new Map((profs ?? []).map((p) => [p.id, p.nome]));
        for (const e of emps) {
          const item: PendingEmprestimo = {
            id: e.id,
            status: e.status as any,
            sala_origem_id: e.sala_origem_id,
            sala_destino_id: e.sala_destino_id,
            sala_origem_nome: sm.get(e.sala_origem_id) ?? "—",
            sala_destino_nome: sm.get(e.sala_destino_id) ?? "—",
            solicitante_nome: um.get(e.solicitante_id) ?? "—",
            created_at: e.created_at,
          };
          if (item.status === "pendente") pend.push(item); else apr.push(item);
        }
      }
      setEmprestimosPendentes(pend);
      setEmprestimosAprovados(apr);
    } else {
      // admin / analista: empréstimos pendentes onde sua sala é a origem (precisa decidir)
      setRequisicoes([]);
      setEmprestimosAprovados([]);
      if (!profile?.sala_id) { setEmprestimosPendentes([]); return; }
      const { data: emps } = await supabase
        .from("emprestimos")
        .select("id, status, sala_origem_id, sala_destino_id, solicitante_id, created_at")
        .eq("status", "pendente")
        .eq("sala_origem_id", profile.sala_id)
        .order("created_at", { ascending: false });
      let pend: PendingEmprestimo[] = [];
      if (emps?.length) {
        const salaIds = [...new Set(emps.flatMap((e) => [e.sala_origem_id, e.sala_destino_id]))];
        const userIds = [...new Set(emps.map((e) => e.solicitante_id))];
        const [{ data: salas }, { data: profs }] = await Promise.all([
          supabase.from("salas").select("id, nome").in("id", salaIds),
          supabase.from("profiles").select("id, nome").in("id", userIds),
        ]);
        const sm = new Map((salas ?? []).map((s) => [s.id, s.nome]));
        const um = new Map((profs ?? []).map((p) => [p.id, p.nome]));
        pend = emps.map((e) => ({
          id: e.id,
          status: "pendente",
          sala_origem_id: e.sala_origem_id,
          sala_destino_id: e.sala_destino_id,
          sala_origem_nome: sm.get(e.sala_origem_id) ?? "—",
          sala_destino_nome: sm.get(e.sala_destino_id) ?? "—",
          solicitante_nome: um.get(e.solicitante_id) ?? "—",
          created_at: e.created_at,
        }));
      }
      setEmprestimosPendentes(pend);
    }

    // Chat: agrega conversas com unread_count > 0
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
  }, [user, role, profile?.sala_id]);

  // initial load
  useEffect(() => {
    if (!user || !role) return;
    initialLoadedRef.current = false;
    refresh().then(() => { initialLoadedRef.current = true; });
  }, [user, role, profile?.sala_id, refresh]);

  // Realtime subscriptions
  useEffect(() => {
    if (!user || !role) return;

    const notify = (title: string, description: string, kind: "info" | "warn", onClick?: () => void) => {
      if (soundEnabled) playBeep(kind);
      toast(title, {
        description,
        duration: 10000,
        action: onClick ? { label: "Ver agora", onClick } : undefined,
      });
    };

    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "solicitacoes" },
        async (payload) => {
          if (role !== "master") return;
          const row: any = payload.new;
          // Buscar nomes
          const [{ data: sala }, { data: prof }] = await Promise.all([
            supabase.from("salas").select("nome").eq("id", row.sala_id).maybeSingle(),
            supabase.from("profiles").select("nome").eq("id", row.usuario_id).maybeSingle(),
          ]);
          notify(
            "🔴 Nova requisição recebida",
            `Sala: ${sala?.nome ?? "—"} · Por: ${prof?.nome ?? "—"}`,
            "warn",
            () => navigate("/app/requisicoes")
          );
          await refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "solicitacoes" },
        async () => { await refresh(); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "emprestimos" },
        async (payload) => {
          const row: any = payload.new;
          const isMasterTarget = role === "master";
          const isAdminOrigem = (role === "admin" || role === "analista") && profile?.sala_id === row.sala_origem_id;
          if (!isMasterTarget && !isAdminOrigem) return;
          const [{ data: salaO }, { data: salaD }] = await Promise.all([
            supabase.from("salas").select("nome").eq("id", row.sala_origem_id).maybeSingle(),
            supabase.from("salas").select("nome").eq("id", row.sala_destino_id).maybeSingle(),
          ]);
          const desc = `De: ${salaD?.nome ?? "—"} → Para: ${salaO?.nome ?? "—"}`;
          notify(
            isAdminOrigem ? "🟡 Sua sala recebeu um pedido de empréstimo" : "🟡 Novo pedido de empréstimo",
            desc,
            "warn",
            () => navigate(role === "admin" ? "/app/aprovar-emprestimos" : "/app/emprestimos")
          );
          await refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "emprestimos" },
        async (payload) => {
          const row: any = payload.new;
          const old: any = payload.old;
          if (role === "master" && old?.status === "pendente" && row?.status === "aprovado") {
            const [{ data: salaO }, { data: salaD }] = await Promise.all([
              supabase.from("salas").select("nome").eq("id", row.sala_origem_id).maybeSingle(),
              supabase.from("salas").select("nome").eq("id", row.sala_destino_id).maybeSingle(),
            ]);
            notify(
              "✅ Empréstimo aprovado",
              `${salaO?.nome ?? "—"} → ${salaD?.nome ?? "—"} · aguarda arquivamento`,
              "info",
              () => navigate("/app/emprestimos")
            );
          }
          await refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const row: any = payload.new;
          if (row.sender_id === user.id) return;
          // Se já está na página de chat olhando esta conversa, apenas refresca
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
            if (onChatPage) {
              navigate(`/app/chat?c=${row.conversation_id}`);
            } else {
              // Abre o chat flutuante diretamente na conversa, sem sair da página
              window.dispatchEvent(new CustomEvent("floating-chat:open", { detail: { conversationId: row.conversation_id } }));
            }
          };
          notify(
            `💬 ${prof?.nome ?? "Nova mensagem"}`,
            row.body ?? (row.attachment_name ? `📎 ${row.attachment_name}` : "Nova mensagem"),
            "info",
            openConv
          );
          await refresh();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, role, profile?.sala_id, soundEnabled, refresh, navigate]);

  // ===== Estado de leitura / fechamento (persistente em localStorage) =====
  const [readIds, setReadIds] = useState<Set<string>>(() => loadSet(READ_KEY));
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadSet(DISMISS_KEY));

  // Auto-limpeza: alertas resolvidos (sumiram da lista ativa) saem do storage
  useEffect(() => {
    const liveIds = new Set<string>([
      ...requisicoes.map((r) => r.id),
      ...emprestimosPendentes.map((e) => e.id),
      ...emprestimosAprovados.map((e) => e.id),
    ]);
    let changedR = false, changedD = false;
    const nextR = new Set<string>();
    readIds.forEach((id) => { if (liveIds.has(id)) nextR.add(id); else changedR = true; });
    const nextD = new Set<string>();
    dismissedIds.forEach((id) => { if (liveIds.has(id)) nextD.add(id); else changedD = true; });
    if (changedR) { setReadIds(nextR); saveSet(READ_KEY, nextR); }
    if (changedD) { setDismissedIds(nextD); saveSet(DISMISS_KEY, nextD); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisicoes, emprestimosPendentes, emprestimosAprovados]);

  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);
  const isDismissed = useCallback((id: string) => dismissedIds.has(id), [dismissedIds]);

  const markRead = useCallback((id: string) => {
    setReadIds((s) => { const n = new Set(s); n.add(id); saveSet(READ_KEY, n); return n; });
  }, []);
  const markUnread = useCallback((id: string) => {
    setReadIds((s) => { const n = new Set(s); n.delete(id); saveSet(READ_KEY, n); return n; });
  }, []);
  const dismiss = useCallback((id: string) => {
    setDismissedIds((s) => { const n = new Set(s); n.add(id); saveSet(DISMISS_KEY, n); return n; });
    setReadIds((s) => { const n = new Set(s); n.add(id); saveSet(READ_KEY, n); return n; });
  }, []);
  const restore = useCallback((id: string) => {
    setDismissedIds((s) => { const n = new Set(s); n.delete(id); saveSet(DISMISS_KEY, n); return n; });
  }, []);

  const allIds = useMemo(
    () => [
      ...requisicoes.map((r) => r.id),
      ...emprestimosPendentes.map((e) => e.id),
      ...emprestimosAprovados.map((e) => e.id),
    ],
    [requisicoes, emprestimosPendentes, emprestimosAprovados]
  );

  const markAllRead = useCallback(() => {
    const all = new Set<string>(allIds);
    setReadIds(all); saveSet(READ_KEY, all);
  }, [allIds]);
  const dismissAll = useCallback(() => {
    const all = new Set<string>(allIds);
    setDismissedIds(all); saveSet(DISMISS_KEY, all);
    setReadIds(all); saveSet(READ_KEY, all);
  }, [allIds]);

  // não lidos = sino vermelho. Pendência fechada continua aparecendo no sino (mas marcada como lida).
  const totalCount = allIds.filter((id) => !readIds.has(id)).length;
  // ativos = não fechados. Usado para banners do dashboard.
  const activeCount = allIds.filter((id) => !dismissedIds.has(id)).length;

  const perSalaCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of requisicoes) {
      if (readIds.has(r.id)) continue;
      map[r.sala_id] = (map[r.sala_id] ?? 0) + 1;
    }
    for (const e of emprestimosPendentes) {
      if (readIds.has(e.id)) continue;
      map[e.sala_origem_id] = (map[e.sala_origem_id] ?? 0) + 1;
    }
    for (const e of emprestimosAprovados) {
      if (readIds.has(e.id)) continue;
      map[e.sala_origem_id] = (map[e.sala_origem_id] ?? 0) + 1;
    }
    return map;
  }, [requisicoes, emprestimosPendentes, emprestimosAprovados, readIds]);

  const value: Ctx = {
    requisicoes,
    emprestimosPendentes,
    emprestimosAprovados,
    chatAlerts,
    totalCount: totalCount + chatAlerts.reduce((s, c) => s + c.unread_count, 0),
    activeCount,
    perSalaCount,
    isRead, isDismissed,
    markRead, markUnread, dismiss, restore,
    markAllRead, dismissAll,
    soundEnabled,
    toggleSound,
    refresh,
  };

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications deve ser usado dentro de NotificationsProvider");
  return ctx;
}
