import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, X, ArrowLeft, Send, Maximize2, Search, Building2, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ConvRow = {
  id: string;
  type: "direct" | "sala" | "master";
  sala_id: string | null;
  owner_user_id: string | null;
  title: string | null;
  related_requisicao_id: string | null;
  related_emprestimo_id: string | null;
  updated_at: string;
  last_message_body: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread_count: number;
};
type Msg = {
  id: string; conversation_id: string; sender_id: string;
  body: string | null; attachment_path: string | null;
  attachment_name: string | null; attachment_type: string | null;
  created_at: string;
};

const POS_KEY = "floating_chat_pos";

const initialsOf = (n?: string) => {
  if (!n) return "?";
  const p = n.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
};
const colorOf = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 45%)`;
};
const shortTime = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((+today - +that) / 86400000);
  if (diff === 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export default function FloatingChat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState("");
  const [profilesMap, setProfilesMap] = useState<Record<string, { nome: string; sala_id?: string | null }>>({});
  const [salasMap, setSalasMap] = useState<Record<string, string>>({});
  const [directOthers, setDirectOthers] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState<{ right: number; bottom: number }>(() => {
    try {
      const r = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (r && typeof r.right === "number" && typeof r.bottom === "number") return r;
    } catch {}
    return { right: 24, bottom: 24 };
  });
  const drag = useRef({ dragging: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false });

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { dragging: true, sx: e.clientX, sy: e.clientY, ox: pos.right, oy: pos.bottom, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.dragging) return;
    const dx = e.clientX - drag.current.sx;
    const dy = e.clientY - drag.current.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.current.moved = true;
    const right = Math.max(8, Math.min(window.innerWidth - 64, drag.current.ox - dx));
    const bottom = Math.max(8, Math.min(window.innerHeight - 64, drag.current.oy - dy));
    setPos({ right, bottom });
  };
  const onPointerUp = () => {
    if (drag.current.dragging) {
      drag.current.dragging = false;
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
    }
  };
  const onClick = () => { if (!drag.current.moved) setOpen((o) => !o); };

  const loadConvs = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_my_conversations");
    if (!error) setConvs((data ?? []) as ConvRow[]);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const { data } = await supabase.from("messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true });
    setMessages((data ?? []) as Msg[]);
    await supabase.rpc("mark_conversation_read", { _conv: id });
    loadConvs();
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ block: "end" }), 30);
  }, [loadConvs]);

  useEffect(() => { if (user) loadConvs(); }, [user, loadConvs]);
  useEffect(() => {
    supabase.from("salas").select("id, nome").then(({ data }) => {
      if (data) setSalasMap(Object.fromEntries(data.map((s: any) => [s.id, s.nome])));
    });
  }, []);

  // perfis necessários
  useEffect(() => {
    const ids = new Set<string>();
    convs.forEach((c) => { if (c.owner_user_id) ids.add(c.owner_user_id); if (c.last_sender_id) ids.add(c.last_sender_id); });
    messages.forEach((m) => ids.add(m.sender_id));
    Object.values(directOthers).forEach((id) => ids.add(id));
    const missing = [...ids].filter((id) => !profilesMap[id]);
    if (!missing.length) return;
    supabase.from("profiles").select("id, nome, sala_id").in("id", missing).then(({ data }) => {
      if (data) setProfilesMap((p) => ({ ...p, ...Object.fromEntries(data.map((d: any) => [d.id, { nome: d.nome, sala_id: d.sala_id }])) }));
    });
  }, [convs, messages, directOthers, profilesMap]);

  // outro participante das DMs
  useEffect(() => {
    const dms = convs.filter((c) => c.type === "direct" && !directOthers[c.id]);
    if (!dms.length || !user) return;
    supabase.from("conversation_participants").select("conversation_id, user_id")
      .in("conversation_id", dms.map((c) => c.id)).then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        dms.forEach((c) => {
          const o = data.find((d) => d.conversation_id === c.id && d.user_id !== user.id);
          if (o) map[c.id] = o.user_id;
        });
        if (Object.keys(map).length) setDirectOthers((p) => ({ ...p, ...map }));
      });
  }, [convs, user, directOthers]);

  useEffect(() => { if (activeId) loadMessages(activeId); else setMessages([]); }, [activeId, loadMessages]);

  // realtime
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("floating-chat-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload: any) => {
        const m = payload.new as Msg;
        if (m.conversation_id === activeIdRef.current) {
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          supabase.rpc("mark_conversation_read", { _conv: m.conversation_id });
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 30);
        }
        loadConvs();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConvs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, loadConvs]);

  // listener: abrir conversa específica (vindo de notificação)
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.conversationId as string | undefined;
      if (!id) return;
      setOpen(true);
      setActiveId(id);
      loadConvs();
    };
    window.addEventListener("floating-chat:open", handler);
    return () => window.removeEventListener("floating-chat:open", handler);
  }, [loadConvs]);

  const totalUnread = convs.reduce((s, c) => s + (c.unread_count ?? 0), 0);

  type UI = { name: string; icon?: JSX.Element; seed: string };
  const describe = (c: ConvRow): UI => {
    if (c.type === "sala") {
      const name = (c.sala_id && salasMap[c.sala_id]) || c.title || "Sala";
      return { name, icon: <Building2 className="size-4" />, seed: `sala:${c.sala_id ?? name}` };
    }
    if (c.type === "master") {
      const owner = c.owner_user_id ? profilesMap[c.owner_user_id]?.nome : null;
      return { name: owner ?? "Master", icon: <Crown className="size-4" />, seed: `m:${c.owner_user_id}` };
    }
    const oid = directOthers[c.id];
    const p = oid ? profilesMap[oid] : null;
    return { name: p?.nome ?? c.title ?? "Conversa", seed: oid ?? c.id };
  };

  const send = async () => {
    if (!activeId || !body.trim()) return;
    const text = body.trim();
    setBody("");
    const { error } = await supabase.rpc("send_message", { _conv: activeId, _body: text });
    if (error) { toast.error(error.message); setBody(text); }
    else loadConvs();
  };

  const filtered = convs.filter((c) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    const d = describe(c);
    return d.name.toLowerCase().includes(q) || (c.last_message_body ?? "").toLowerCase().includes(q);
  });

  // Esconder em telas que não fazem sentido
  if (!user) return null;
  if (location.pathname.startsWith("/app/chat")) return null;
  if (location.pathname === "/login" || location.pathname.startsWith("/app/trocar-senha")) return null;
  if (location.pathname.startsWith("/app/escolher-sala")) return null;

  const active = convs.find((c) => c.id === activeId) ?? null;
  const activeUI = active ? describe(active) : (activeId ? { name: "Conversa", seed: activeId } as UI : null);

  return (
    <>
      {open && (
        <div
          className="fixed z-50 bg-card border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-scale-in"
          style={{
            right: pos.right,
            bottom: pos.bottom + 72,
            width: 380,
            height: 520,
            maxHeight: "80vh",
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/40">
            {activeId && (
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setActiveId(null)} title="Voltar">
                <ArrowLeft className="size-4" />
              </Button>
            )}
            <div className="flex-1 font-semibold text-sm truncate flex items-center gap-2">
              {activeUI ? (
                <>
                  <div className="size-7 rounded-full grid place-items-center text-white text-[11px] font-semibold shrink-0" style={{ background: colorOf(activeUI.seed) }}>
                    {activeUI.icon ?? initialsOf(activeUI.name)}
                  </div>
                  <span className="truncate">{activeUI.name}</span>
                </>
              ) : (
                <>
                  <MessageCircle className="size-4 text-primary" />
                  <span>Conversas</span>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => { navigate(activeId ? `/app/chat?c=${activeId}` : "/app/chat"); setOpen(false); }}
              title="Abrir chat completo"
            >
              <Maximize2 className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setOpen(false)} title="Fechar">
              <X className="size-4" />
            </Button>
          </div>

          {!activeId ? (
            <>
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Buscar conversas…"
                    className="pl-8 h-9 text-sm"
                  />
                </div>
              </div>
              <ScrollArea className="flex-1">
                {filtered.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    <MessageCircle className="size-6 mx-auto mb-2 opacity-40" />
                    <div>Nenhuma conversa.</div>
                    <button
                      className="text-primary underline mt-2"
                      onClick={() => { navigate("/app/chat"); setOpen(false); }}
                    >
                      Iniciar uma conversa
                    </button>
                  </div>
                ) : (
                  <ul>
                    {filtered.map((c) => {
                      const d = describe(c);
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => setActiveId(c.id)}
                            className="w-full text-left px-3 py-2 flex gap-2.5 items-center hover:bg-accent/50 transition-colors border-l-2 border-transparent"
                          >
                            <div className="size-9 rounded-full grid place-items-center text-white text-[11px] font-semibold shrink-0 shadow-sm" style={{ background: colorOf(d.seed) }}>
                              {d.icon ?? initialsOf(d.name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className={cn("truncate text-sm", c.unread_count > 0 ? "font-semibold" : "font-medium")}>{d.name}</div>
                                {c.last_message_at && (
                                  <span className={cn("text-[10px] shrink-0", c.unread_count > 0 ? "text-primary font-semibold" : "text-muted-foreground")}>
                                    {shortTime(c.last_message_at)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <div className={cn("text-xs truncate", c.unread_count > 0 ? "text-foreground" : "text-muted-foreground")}>
                                  {c.last_message_body ?? "Sem mensagens"}
                                </div>
                                {c.unread_count > 0 && (
                                  <Badge className="bg-primary text-primary-foreground h-4 min-w-4 px-1 rounded-full text-[9px] font-bold">
                                    {c.unread_count}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ScrollArea>
            </>
          ) : (
            <>
              <ScrollArea className="flex-1 px-3 py-3 bg-gradient-to-b from-background to-muted/10">
                <div className="space-y-1.5">
                  {messages.map((m, i) => {
                    const mine = m.sender_id === user?.id;
                    const prev = messages[i - 1];
                    const showName = !mine && (!prev || prev.sender_id !== m.sender_id);
                    const time = new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm shadow-sm",
                            mine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border rounded-bl-md"
                          )}
                        >
                          {showName && (
                            <div className="text-[10px] font-semibold opacity-80 mb-0.5" style={{ color: mine ? undefined : colorOf(m.sender_id) }}>
                              {profilesMap[m.sender_id]?.nome ?? "Usuário"}
                            </div>
                          )}
                          {m.body && <div className="whitespace-pre-wrap break-words leading-snug">{m.body}</div>}
                          {m.attachment_name && <div className="text-[11px] italic mt-1">📎 {m.attachment_name}</div>}
                          <div className={cn("text-[9px] mt-0.5", mine ? "text-primary-foreground/70 text-right" : "text-muted-foreground")}>{time}</div>
                        </div>
                      </div>
                    );
                  })}
                  {messages.length === 0 && (
                    <div className="text-center text-xs text-muted-foreground py-8">
                      <MessageCircle className="size-6 mx-auto mb-2 opacity-40" />
                      Nenhuma mensagem ainda. Diga olá 👋
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
              <div className="p-2 border-t flex gap-1.5 items-end bg-muted/20">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Mensagem…"
                  rows={1}
                  className="min-h-[36px] max-h-24 resize-none text-sm rounded-2xl bg-background"
                />
                <Button size="icon" className="size-9 rounded-full shrink-0 shadow-md" onClick={send} disabled={!body.trim()}>
                  <Send className="size-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        className="fixed z-50 size-14 rounded-full bg-primary text-primary-foreground shadow-xl hover:shadow-2xl transition-shadow grid place-items-center cursor-grab active:cursor-grabbing select-none"
        style={{ right: pos.right, bottom: pos.bottom, touchAction: "none" }}
        aria-label="Abrir chat"
      >
        <MessageCircle className="size-6" />
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center animate-pulse">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>
    </>
  );
}
