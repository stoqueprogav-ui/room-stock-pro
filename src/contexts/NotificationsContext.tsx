import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode, useMemo } from "react";
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

type Ctx = {
  requisicoes: PendingRequisicao[];
  emprestimosPendentes: PendingEmprestimo[];
  emprestimosAprovados: PendingEmprestimo[];
  totalCount: number;
  perSalaCount: Record<string, number>;
  soundEnabled: boolean;
  toggleSound: () => void;
  refresh: () => Promise<void>;
};

const NotificationsContext = createContext<Ctx | undefined>(undefined);

const SOUND_KEY = "notif_sound_enabled";

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
  const [requisicoes, setRequisicoes] = useState<PendingRequisicao[]>([]);
  const [emprestimosPendentes, setEmprestimosPendentes] = useState<PendingEmprestimo[]>([]);
  const [emprestimosAprovados, setEmprestimosAprovados] = useState<PendingEmprestimo[]>([]);
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
      const { data: reqs } = await supabase
        .from("solicitacoes")
        .select("id, sala_id, created_at, sala:salas(nome), usuario:profiles!solicitacoes_usuario_id_fkey(nome)")
        .eq("status", "pendente")
        .order("created_at", { ascending: false });
      // fallback sem FK nomeada — buscar via duas queries se necessário
      let reqsMapped: PendingRequisicao[] = [];
      if (reqs && reqs.length) {
        reqsMapped = reqs.map((r: any) => ({
          id: r.id,
          sala_id: r.sala_id,
          sala_nome: r.sala?.nome ?? "—",
          usuario_nome: r.usuario?.nome ?? "—",
          created_at: r.created_at,
        }));
      } else {
        // fallback manual (caso o embed por FK falhe)
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
            () => { window.location.href = "/app/requisicoes"; }
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
            () => {
              window.location.href = role === "admin" ? "/app/aprovar-emprestimos" : "/app/emprestimos";
            }
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
              () => { window.location.href = "/app/emprestimos"; }
            );
          }
          await refresh();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, role, profile?.sala_id, soundEnabled, refresh]);

  const totalCount = requisicoes.length + emprestimosPendentes.length + emprestimosAprovados.length;

  const perSalaCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of requisicoes) map[r.sala_id] = (map[r.sala_id] ?? 0) + 1;
    for (const e of emprestimosPendentes) {
      map[e.sala_origem_id] = (map[e.sala_origem_id] ?? 0) + 1;
    }
    for (const e of emprestimosAprovados) {
      map[e.sala_origem_id] = (map[e.sala_origem_id] ?? 0) + 1;
    }
    return map;
  }, [requisicoes, emprestimosPendentes, emprestimosAprovados]);

  const value: Ctx = {
    requisicoes,
    emprestimosPendentes,
    emprestimosAprovados,
    totalCount,
    perSalaCount,
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
