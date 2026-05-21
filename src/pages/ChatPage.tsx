import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/AppLayout";
import { MessageCircle, Send, Paperclip, Plus, Search, Building2, Crown, User as UserIcon, Settings, Download, Check, CheckCheck, Sparkles } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationsContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
  _pending?: boolean;
};

type RoleStr = "master" | "admin" | "analista" | undefined;

// ---- Helpers de UI ----
const initialsOf = (name?: string) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
};

// Cor estável a partir do id (HSL) — paleta agradável
const colorOf = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 65% 45%)`;
};

const Avatar = ({ name, seed, icon, size = 40, ring }: { name?: string; seed?: string; icon?: JSX.Element; size?: number; ring?: string }) => {
  const bg = seed ? colorOf(seed) : undefined;
  return (
    <div
      className="rounded-full grid place-items-center shrink-0 text-white font-semibold select-none shadow-sm"
      style={{ width: size, height: size, background: bg ?? "hsl(var(--muted))", fontSize: size * 0.4, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
    >
      {icon ?? <span className="text-white/95">{initialsOf(name)}</span>}
    </div>
  );
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const smartTime = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const diffDays = Math.round((today - that) / 86400000);
  const hhmm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return hhmm;
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};
const fullDateLabel = (iso: string) => {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const diffDays = Math.round((today - that) / 86400000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
};

export default function ChatPage() {
  const { user, role } = useAuth();
  const { refresh: refreshNotifs } = useNotifications();
  const [params, setParams] = useSearchParams();
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(params.get("c"));
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [profilesMap, setProfilesMap] = useState<Record<string, { nome: string; email: string }>>({});
  const [rolesMap, setRolesMap] = useState<Record<string, RoleStr>>({});
  const [salasMap, setSalasMap] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    }, 30);
  }, []);

  const loadConvs = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_my_conversations");
    if (error) { console.error(error); return; }
    setConvs((data ?? []) as ConvRow[]);
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (error) { console.error(error); return; }
    setMessages((data ?? []) as Msg[]);
    await supabase.rpc("mark_conversation_read", { _conv: convId });
    loadConvs();
    refreshNotifs();
    scrollToBottom();
  }, [loadConvs, scrollToBottom, refreshNotifs]);

  // Carrega salas (global) e roles uma vez
  useEffect(() => {
    supabase.from("salas").select("id, nome").then(({ data }) => {
      if (data) setSalasMap(Object.fromEntries(data.map((s: any) => [s.id, s.nome])));
    });
    supabase.from("user_roles").select("user_id, role").then(({ data }) => {
      if (data) setRolesMap(Object.fromEntries(data.map((r: any) => [r.user_id, r.role])));
    });
  }, []);

  // Carrega nomes/sala dos usuários relevantes
  useEffect(() => {
    const ids = new Set<string>();
    convs.forEach(c => { if (c.owner_user_id) ids.add(c.owner_user_id); if (c.last_sender_id) ids.add(c.last_sender_id); });
    messages.forEach(m => ids.add(m.sender_id));
    const missing = [...ids].filter(id => !profilesMap[id]);
    if (missing.length === 0) return;
    supabase.from("profiles").select("id, nome, email, sala_id").in("id", missing).then(({ data }) => {
      if (!data) return;
      setProfilesMap(p => ({ ...p, ...Object.fromEntries(data.map((d: any) => [d.id, { nome: d.nome, email: d.email, sala_id: d.sala_id }])) }));
    });
  }, [convs, messages, profilesMap]);

  useEffect(() => { loadConvs(); }, [loadConvs]);
  useEffect(() => { if (activeId) loadMessages(activeId); else setMessages([]); }, [activeId, loadMessages]);

  // Realtime
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("chat-incoming")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload: any) => {
        const m = payload.new as Msg;
        const isActive = m.conversation_id === activeIdRef.current;
        if (isActive) {
          setMessages(prev => {
            if (prev.some(x => x.id === m.id)) return prev;
            const withoutPending = prev.filter(x => !(x._pending && x.sender_id === m.sender_id && (x.body ?? "") === (m.body ?? "")));
            return [...withoutPending, m];
          });
          supabase.rpc("mark_conversation_read", { _conv: m.conversation_id });
          scrollToBottom(true);
        }
        loadConvs();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConvs())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, loadConvs, scrollToBottom]);

  const [activeFallback, setActiveFallback] = useState<ConvRow | null>(null);
  const active = convs.find(c => c.id === activeId) ?? (activeFallback?.id === activeId ? activeFallback : null);
  // (mergedConvs definido mais abaixo, junto a filteredConvs)

  // Para DMs, buscar o outro participante
  const [directOthers, setDirectOthers] = useState<Record<string, string>>({});
  useEffect(() => {
    const dms = convs.filter(c => c.type === "direct" && !directOthers[c.id]);
    if (dms.length === 0 || !user) return;
    (async () => {
      const { data } = await supabase
        .from("conversation_participants")
        .select("conversation_id, user_id")
        .in("conversation_id", dms.map(c => c.id));
      if (!data) return;
      const map: Record<string, string> = {};
      dms.forEach(c => {
        const other = data.find(d => d.conversation_id === c.id && d.user_id !== user.id);
        if (other) map[c.id] = other.user_id;
      });
      setDirectOthers(p => ({ ...p, ...map }));
      const missing = Object.values(map).filter(id => !profilesMap[id]);
      if (missing.length) {
        const { data: profs } = await supabase.from("profiles").select("id,nome,email,sala_id").in("id", missing);
        if (profs) setProfilesMap(p => ({ ...p, ...Object.fromEntries(profs.map((d: any) => [d.id, { nome: d.nome, email: d.email, sala_id: d.sala_id }])) }));
      }
    })();
  }, [convs, user, directOthers, profilesMap]);

  // Descritor visual da conversa
  type ConvUI = { name: string; subtitle: string; seed: string; icon?: JSX.Element };
  const describeConv = (c: ConvRow): ConvUI => {
    if (c.type === "sala") {
      const nome = (c.sala_id && salasMap[c.sala_id]) || c.title || "Sala";
      return { name: nome, subtitle: "Conversa da sala", seed: `sala:${c.sala_id ?? nome}`, icon: <Building2 className="size-4" /> };
    }
    if (c.type === "master") {
      const ownerName = c.owner_user_id ? profilesMap[c.owner_user_id]?.nome : null;
      const name = role === "master" ? `${ownerName ?? "Usuário"}` : "Master";
      const sub = role === "master" ? "Conversa com usuário" : "Suporte / Administração";
      return { name, subtitle: sub, seed: `master:${c.owner_user_id ?? "x"}`, icon: <Crown className="size-4" /> };
    }
    const oid = directOthers[c.id];
    const p = oid ? profilesMap[oid] : null;
    const r = oid ? rolesMap[oid] : undefined;
    const salaId = oid ? (p as any)?.sala_id : null;
    const salaNome = salaId ? salasMap[salaId] : null;
    const roleLabel = r === "master" ? "Master" : r === "admin" ? "Administrador" : r === "analista" ? "Analista" : "Usuário";
    return {
      name: p?.nome ?? c.title ?? "Conversa",
      subtitle: salaNome ? `${roleLabel} · ${salaNome}` : roleLabel,
      seed: oid ?? c.id,
    };
  };

  // Mescla fallback (conversa recém-criada ainda não retornada pelo RPC) à lista
  const mergedConvs = useMemo(() => {
    if (!activeFallback) return convs;
    if (convs.some(c => c.id === activeFallback.id)) return convs;
    return [activeFallback, ...convs];
  }, [convs, activeFallback]);

  const filteredConvs = useMemo(() => {
    if (!filter.trim()) return mergedConvs;
    const q = filter.toLowerCase();
    return mergedConvs.filter(c => {
      const d = describeConv(c);
      return d.name.toLowerCase().includes(q) ||
        d.subtitle.toLowerCase().includes(q) ||
        (c.last_message_body ?? "").toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedConvs, filter, directOthers, profilesMap, rolesMap, salasMap]);

  // Quem fala última msg na sidebar (pra prefixo "Você: ")
  const lastSenderLabel = (c: ConvRow) => {
    if (!c.last_sender_id) return "";
    if (c.last_sender_id === user?.id) return "Você: ";
    if (c.type === "sala" || c.type === "master") {
      const n = profilesMap[c.last_sender_id]?.nome;
      return n ? `${n.split(" ")[0]}: ` : "";
    }
    return "";
  };

  const handleSend = async () => {
    if (!activeId || !user) return;
    const text = body.trim();
    if (!text) return;
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    const optimistic: Msg = {
      id: tempId, conversation_id: activeId, sender_id: user.id,
      body: text, attachment_path: null, attachment_name: null, attachment_type: null,
      created_at: new Date().toISOString(), _pending: true,
    };
    setMessages(prev => [...prev, optimistic]);
    setBody("");
    scrollToBottom(true);
    const { error } = await supabase.rpc("send_message", { _conv: activeId, _body: text });
    setSending(false);
    if (error) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      toast.error(error.message);
      setBody(text);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeId) return;
    if (file.size > 20 * 1024 * 1024) { toast.error("Arquivo > 20MB"); return; }
    const path = `${activeId}/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("chat-anexos").upload(path, file);
    if (upErr) { toast.error(upErr.message); return; }
    const { error } = await supabase.rpc("send_message", {
      _conv: activeId, _body: body.trim() || null,
      _attachment_path: path, _attachment_name: file.name, _attachment_type: file.type,
    });
    if (error) { toast.error(error.message); return; }
    setBody("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadAttachment = async (m: Msg) => {
    if (!m.attachment_path) return;
    const { data, error } = await supabase.storage.from("chat-anexos").createSignedUrl(m.attachment_path, 60);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  };

  const setActive = (id: string) => { setActiveId(id); setParams({ c: id }, { replace: true }); };

  const handleCreated = (id: string, fb?: CreatedFallback) => {
    if (fb) {
      setActiveFallback({
        id, type: fb.type ?? "direct",
        sala_id: fb.sala_id ?? null, owner_user_id: fb.owner_user_id ?? null,
        title: fb.title ?? null, related_requisicao_id: null, related_emprestimo_id: null,
        updated_at: new Date().toISOString(),
        last_message_body: null, last_message_at: null, last_sender_id: null, unread_count: 0,
      });
      if (fb.otherUserId) {
        setDirectOthers(p => ({ ...p, [id]: fb.otherUserId! }));
        if (fb.otherUserName) setProfilesMap(p => ({ ...p, [fb.otherUserId!]: { nome: fb.otherUserName!, email: "" } }));
      }
    }
    setActive(id);
    loadConvs();
  };

  // Agrupa mensagens por dia para separadores
  const groupedMessages = useMemo(() => {
    const out: { day: string; items: Msg[] }[] = [];
    messages.forEach(m => {
      const day = new Date(m.created_at).toDateString();
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    });
    return out;
  }, [messages]);

  const activeUI = active ? describeConv(active) : null;

  return (
    <div>
      <PageHeader
        title="Chat"
        description="Converse livremente com qualquer usuário, sala ou com o Master."
        actions={
          <div className="flex gap-2">
            <NewConversationDialog onCreated={handleCreated} />
            {role === "master" && <MasterSettingsDialog />}
          </div>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-220px)]">
        {/* Sidebar */}
        <aside className="border rounded-xl flex flex-col bg-card overflow-hidden shadow-sm">
          <div className="p-3 border-b bg-muted/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Buscar conversas, usuários, salas…"
                className="pl-9 h-9 bg-background"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {filteredConvs.length === 0 ? (
              <EmptyConversationsList onCreated={handleCreated} />
            ) : (
              <ul>
                {filteredConvs.map(c => {
                  const d = describeConv(c);
                  const isActive = activeId === c.id;
                  const preview = c.last_message_body ?? "Sem mensagens ainda";
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setActive(c.id)}
                        className={cn(
                          "w-full text-left px-3 py-2.5 flex gap-3 items-center transition-colors border-l-2",
                          isActive ? "bg-accent border-primary" : "border-transparent hover:bg-accent/50"
                        )}
                      >
                        <Avatar name={d.name} seed={d.seed} icon={d.icon} size={44} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className={cn("truncate text-sm", c.unread_count > 0 ? "font-semibold" : "font-medium")}>
                              {d.name}
                            </div>
                            {c.last_message_at && (
                              <span className={cn("text-[11px] shrink-0", c.unread_count > 0 ? "text-primary font-medium" : "text-muted-foreground")}>
                                {smartTime(c.last_message_at)}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">{d.subtitle}</div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <div className={cn(
                              "text-xs truncate",
                              c.unread_count > 0 ? "text-foreground font-medium" : "text-muted-foreground"
                            )}>
                              {lastSenderLabel(c)}{preview}
                            </div>
                            {c.unread_count > 0 && (
                              <Badge className="bg-primary text-primary-foreground h-5 min-w-5 px-1.5 rounded-full text-[10px] font-bold shadow">
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
        </aside>

        {/* Conversa */}
        <section className="border rounded-xl flex flex-col bg-card min-w-0 overflow-hidden shadow-sm">
          {!active ? (
            <EmptyChatHero onCreated={handleCreated} />
          ) : (
            <>
              <header className="px-4 py-3 border-b flex items-center gap-3 bg-muted/30">
                <Avatar name={activeUI!.name} seed={activeUI!.seed} icon={activeUI!.icon} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate leading-tight">{activeUI!.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{activeUI!.subtitle}</div>
                </div>
              </header>

              <ScrollArea className="flex-1 px-4 py-4 bg-gradient-to-b from-background to-muted/10">
                <div className="space-y-4">
                  {groupedMessages.map(group => (
                    <div key={group.day} className="space-y-2">
                      <div className="flex justify-center">
                        <span className="text-[10px] uppercase tracking-wider bg-muted px-2.5 py-1 rounded-full text-muted-foreground font-medium">
                          {fullDateLabel(group.items[0].created_at)}
                        </span>
                      </div>
                      {group.items.map((m, i) => {
                        const mine = m.sender_id === user?.id;
                        const prof = profilesMap[m.sender_id];
                        const prev = group.items[i - 1];
                        const showName = !mine && (!prev || prev.sender_id !== m.sender_id);
                        const time = new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                        return (
                          <div key={m.id} className={cn("flex gap-2 animate-fade-in", mine ? "justify-end" : "justify-start")}>
                            {!mine && (
                              <div className={cn("self-end", showName ? "opacity-100" : "opacity-0")}>
                                <Avatar name={prof?.nome} seed={m.sender_id} size={28} />
                              </div>
                            )}
                            <div className={cn(
                              "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                              mine
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-card border rounded-bl-md",
                              m._pending && "opacity-70"
                            )}>
                              {showName && (
                                <div className="text-[11px] font-semibold mb-0.5" style={{ color: colorOf(m.sender_id) }}>
                                  {prof?.nome ?? "Usuário removido"}
                                </div>
                              )}
                              {m.body && <div className="whitespace-pre-wrap break-words leading-snug">{m.body}</div>}
                              {m.attachment_path && (
                                <button
                                  onClick={() => downloadAttachment(m)}
                                  className={cn(
                                    "mt-1.5 flex items-center gap-1.5 text-xs underline-offset-2 hover:underline",
                                    mine ? "text-primary-foreground/90" : "text-primary"
                                  )}
                                >
                                  <Download className="size-3.5" /> {m.attachment_name}
                                </button>
                              )}
                              <div className={cn(
                                "text-[10px] mt-1 flex items-center gap-1",
                                mine ? "justify-end text-primary-foreground/70" : "text-muted-foreground"
                              )}>
                                <span>{time}</span>
                                {mine && (m._pending ? <Check className="size-3" /> : <CheckCheck className="size-3" />)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {messages.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-12">
                      <MessageCircle className="size-8 mx-auto mb-2 opacity-40" />
                      Nenhuma mensagem ainda. Diga olá 👋
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="p-3 border-t bg-muted/30 flex gap-2 items-end">
                <input ref={fileRef} type="file" className="hidden" onChange={handleFile} accept="image/*,application/pdf" />
                <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} title="Anexar PDF/imagem" className="shrink-0">
                  <Paperclip className="size-5 text-muted-foreground" />
                </Button>
                <Textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Digite uma mensagem…"
                  className="min-h-[44px] max-h-32 resize-none bg-background rounded-2xl border-muted"
                  rows={1}
                />
                <Button
                  onClick={handleSend}
                  disabled={sending || !body.trim()}
                  size="icon"
                  className="shrink-0 rounded-full size-10 shadow-md"
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ===== Estado vazio: sidebar sem conversas =====
function EmptyConversationsList({ onCreated }: { onCreated: (id: string, fb?: CreatedFallback) => void }) {
  return (
    <div className="p-6 text-center space-y-3">
      <div className="size-12 mx-auto rounded-full bg-primary/10 grid place-items-center">
        <MessageCircle className="size-6 text-primary" />
      </div>
      <div>
        <div className="font-medium text-sm">Sem conversas ainda</div>
        <p className="text-xs text-muted-foreground mt-1">Inicie uma conversa com qualquer usuário ou sala.</p>
      </div>
      <div className="pt-1">
        <NewConversationDialog onCreated={onCreated} compact />
      </div>
    </div>
  );
}

// ===== Estado vazio: nenhuma conversa selecionada =====
function EmptyChatHero({ onCreated }: { onCreated: (id: string, fb?: CreatedFallback) => void }) {
  const { user } = useAuth();
  const [suggested, setSuggested] = useState<{ id: string; nome: string; sala_id: string | null }[]>([]);
  const [salasMap, setSalasMap] = useState<Record<string, string>>({});
  const [rolesMap, setRolesMap] = useState<Record<string, RoleStr>>({});

  useEffect(() => {
    supabase.from("salas").select("id, nome").then(({ data }) => {
      if (data) setSalasMap(Object.fromEntries(data.map((s: any) => [s.id, s.nome])));
    });
    supabase.from("user_roles").select("user_id, role").then(({ data }) => {
      if (data) setRolesMap(Object.fromEntries(data.map((r: any) => [r.user_id, r.role])));
    });
    supabase.from("profiles").select("id, nome, sala_id").order("nome").limit(8).then(({ data }) => {
      if (data && user) setSuggested(data.filter((u: any) => u.id !== user.id) as any);
    });
  }, [user]);

  const start = async (u: { id: string; nome: string }) => {
    const { data, error } = await supabase.rpc("get_or_create_direct_conversation", { _other: u.id });
    if (error) { toast.error(error.message); return; }
    onCreated(data as string, { type: "direct", title: u.nome, otherUserId: u.id, otherUserName: u.nome });
  };

  return (
    <div className="flex-1 grid place-items-center p-8">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="size-16 mx-auto rounded-2xl bg-primary/10 grid place-items-center shadow-sm">
          <Sparkles className="size-8 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Bem-vindo ao Chat</h2>
          <p className="text-sm text-muted-foreground mt-1">Selecione uma conversa à esquerda ou inicie uma nova com qualquer usuário.</p>
        </div>
        {suggested.length > 0 && (
          <div className="text-left">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Sugestões</div>
            <div className="grid grid-cols-1 gap-1.5">
              {suggested.slice(0, 5).map(u => {
                const r = rolesMap[u.id];
                const roleLabel = r === "master" ? "Master" : r === "admin" ? "Administrador" : r === "analista" ? "Analista" : "Usuário";
                const sala = u.sala_id ? salasMap[u.sala_id] : null;
                return (
                  <button
                    key={u.id}
                    onClick={() => start(u)}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors border bg-card"
                  >
                    <Avatar name={u.nome} seed={u.id} size={36} />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="font-medium text-sm truncate">{u.nome}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{sala ? `${roleLabel} · ${sala}` : roleLabel}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <NewConversationDialog onCreated={onCreated} />
      </div>
    </div>
  );
}

type CreatedFallback = { type?: ConvRow["type"]; title?: string | null; sala_id?: string | null; owner_user_id?: string | null; otherUserId?: string; otherUserName?: string };

function NewConversationDialog({ onCreated, compact = false }: { onCreated: (id: string, fb?: CreatedFallback) => void; compact?: boolean }) {
  const { user, role, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; nome: string; email: string; sala_id: string | null }[]>([]);
  const [salas, setSalas] = useState<{ id: string; nome: string }[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    supabase.from("profiles").select("id, nome, email, sala_id").order("nome").then(({ data }) => setUsers(data ?? []));
    supabase.from("salas").select("id, nome").order("nome").then(({ data }) => setSalas(data ?? []));
    supabase.from("user_roles").select("user_id, role").then(({ data }) => {
      if (!data) return;
      setRoles(Object.fromEntries(data.map((r: any) => [r.user_id, r.role])));
    });
  }, [open]);

  const salaName = (sid: string | null) => sid ? salas.find(s => s.id === sid)?.nome ?? "—" : "Sem sala";
  const roleLabel = (r?: string) => r === "master" ? "Master" : r === "admin" ? "Administrador" : r === "analista" ? "Analista" : "Usuário";

  const startDirect = async (other: { id: string; nome: string }) => {
    const { data, error } = await supabase.rpc("get_or_create_direct_conversation", { _other: other.id });
    if (error) { toast.error(error.message); return; }
    onCreated(data as string, { type: "direct", title: other.nome, otherUserId: other.id, otherUserName: other.nome });
    setOpen(false);
  };
  const startSala = async (s: { id: string; nome: string }) => {
    const { data, error } = await supabase.rpc("get_or_create_sala_conversation", { _sala: s.id });
    if (error) { toast.error(error.message); return; }
    onCreated(data as string, { type: "sala", title: s.nome, sala_id: s.id });
    setOpen(false);
  };
  const startMaster = async () => {
    const { data, error } = await supabase.rpc("get_or_create_master_conversation", {});
    if (error) { toast.error(error.message); return; }
    onCreated(data as string, { type: "master", title: "Master", owner_user_id: user?.id ?? null });
    setOpen(false);
  };

  const q = search.toLowerCase();
  const filteredUsers = users.filter(u => u.id !== user?.id && (u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || salaName(u.sala_id).toLowerCase().includes(q)));
  const filteredSalas = salas.filter(s => s.nome.toLowerCase().includes(q));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={compact ? "sm" : "sm"}><Plus className="size-4" /> Nova conversa</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Iniciar conversa</DialogTitle></DialogHeader>
        <Input placeholder="Buscar usuário, email ou sala..." value={search} onChange={e => setSearch(e.target.value)} />
        <Tabs defaultValue="users">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="users">Usuários</TabsTrigger>
            <TabsTrigger value="salas">Salas</TabsTrigger>
            {role !== "master" && <TabsTrigger value="master">Master</TabsTrigger>}
          </TabsList>
          <TabsContent value="users">
            <ScrollArea className="h-72">
              {filteredUsers.map(u => {
                const r = roles[u.id];
                return (
                  <button key={u.id} onClick={() => startDirect(u)} className="w-full text-left px-2 py-2 hover:bg-accent rounded-lg flex items-center gap-3">
                    <Avatar name={u.nome} seed={u.id} size={36} icon={r === "master" ? <Crown className="size-4" /> : undefined} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-sm">{u.nome}</div>
                      <div className="text-xs text-muted-foreground truncate">{roleLabel(r)} · {salaName(u.sala_id)}</div>
                    </div>
                  </button>
                );
              })}
              {filteredUsers.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Nenhum usuário</div>}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="salas">
            <ScrollArea className="h-72">
              {filteredSalas.map(s => (
                <button key={s.id} onClick={() => startSala(s)} className="w-full text-left px-2 py-2 hover:bg-accent rounded-lg flex items-center gap-3">
                  <Avatar name={s.nome} seed={`sala:${s.id}`} size={36} icon={<Building2 className="size-4" />} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-sm">{s.nome}</div>
                    <div className="text-xs text-muted-foreground truncate">Conversa de sala</div>
                  </div>
                  {profile?.sala_id === s.id && <Badge variant="secondary" className="ml-auto">Minha sala</Badge>}
                </button>
              ))}
            </ScrollArea>
          </TabsContent>
          {role !== "master" && (
            <TabsContent value="master">
              <div className="p-4">
                <Button onClick={startMaster} className="w-full"><Crown className="size-4" /> Falar com o Master</Button>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function MasterSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [audit, setAudit] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("app_settings").select("value").eq("key", "master_can_read_all_dms").maybeSingle()
      .then(({ data }) => setAudit(data?.value === true));
  }, [open]);

  const save = async (v: boolean) => {
    setLoading(true);
    const { error } = await supabase.from("app_settings").update({ value: v as any, updated_at: new Date().toISOString() }).eq("key", "master_can_read_all_dms");
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setAudit(v);
    toast.success("Configuração atualizada");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Settings className="size-4" /> Configurar</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Configurações do Chat</DialogTitle></DialogHeader>
        <div className="flex items-center justify-between gap-4 py-2">
          <div>
            <Label>Auditoria total do Master</Label>
            <p className="text-xs text-muted-foreground mt-1">Quando ativo, o Master pode ler todas as conversas diretas entre quaisquer usuários.</p>
          </div>
          <Switch checked={audit} disabled={loading} onCheckedChange={save} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
