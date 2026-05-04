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
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { MessageCircle, Send, Paperclip, Plus, Search, Building2, Crown, User as UserIcon, Settings, Download } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
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
};

export default function ChatPage() {
  const { user, role } = useAuth();
  const [params, setParams] = useSearchParams();
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(params.get("c"));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [profilesMap, setProfilesMap] = useState<Record<string, { nome: string; email: string }>>({});
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setTimeout(() => scrollRef.current?.scrollTo({ top: 999999 }), 50);
  }, [loadConvs]);

  // Carrega nomes dos usuários relevantes
  useEffect(() => {
    const ids = new Set<string>();
    convs.forEach(c => { if (c.owner_user_id) ids.add(c.owner_user_id); if (c.last_sender_id) ids.add(c.last_sender_id); });
    messages.forEach(m => ids.add(m.sender_id));
    const missing = [...ids].filter(id => !profilesMap[id]);
    if (missing.length === 0) return;
    supabase.from("profiles").select("id, nome, email").in("id", missing).then(({ data }) => {
      if (!data) return;
      setProfilesMap(p => ({ ...p, ...Object.fromEntries(data.map(d => [d.id, { nome: d.nome, email: d.email }])) }));
    });
  }, [convs, messages, profilesMap]);

  useEffect(() => { loadConvs(); }, [loadConvs]);
  useEffect(() => { if (activeId) loadMessages(activeId); else setMessages([]); }, [activeId, loadMessages]);

  // Realtime
  useRealtimeSync(["messages", "conversations"], () => {
    loadConvs();
    if (activeId) loadMessages(activeId);
  }, { debounceMs: 200 });

  const active = convs.find(c => c.id === activeId);

  const convLabel = (c: ConvRow): { name: string; icon: JSX.Element; sub?: string } => {
    if (c.type === "sala") return { name: c.title || "Sala", icon: <Building2 className="size-4" /> };
    if (c.type === "master") {
      const owner = c.owner_user_id ? profilesMap[c.owner_user_id]?.nome : null;
      return { name: role === "master" ? `Master · ${owner ?? "Usuário"}` : "Master", icon: <Crown className="size-4" /> };
    }
    // direct: precisa do outro participante — buscamos sob demanda
    return { name: c.title || "Conversa direta", icon: <UserIcon className="size-4" /> };
  };

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
        const { data: profs } = await supabase.from("profiles").select("id,nome,email").in("id", missing);
        if (profs) setProfilesMap(p => ({ ...p, ...Object.fromEntries(profs.map(d => [d.id, { nome: d.nome, email: d.email }])) }));
      }
    })();
  }, [convs, user, directOthers, profilesMap]);

  const filteredConvs = useMemo(() => {
    if (!filter.trim()) return convs;
    const q = filter.toLowerCase();
    return convs.filter(c => {
      const lbl = convLabel(c).name.toLowerCase();
      const otherId = c.type === "direct" ? directOthers[c.id] : null;
      const otherName = otherId ? profilesMap[otherId]?.nome.toLowerCase() ?? "" : "";
      return lbl.includes(q) || otherName.includes(q) || (c.last_message_body ?? "").toLowerCase().includes(q);
    });
  }, [convs, filter, directOthers, profilesMap]);

  const handleSend = async () => {
    if (!activeId) return;
    const text = body.trim();
    if (!text) return;
    setSending(true);
    const { error } = await supabase.rpc("send_message", { _conv: activeId, _body: text });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setBody("");
    loadMessages(activeId);
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
    loadMessages(activeId);
  };

  const downloadAttachment = async (m: Msg) => {
    if (!m.attachment_path) return;
    const { data, error } = await supabase.storage.from("chat-anexos").createSignedUrl(m.attachment_path, 60);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  };

  const setActive = (id: string) => { setActiveId(id); setParams({ c: id }, { replace: true }); };

  return (
    <div>
      <PageHeader
        title="Chat"
        description="Conversas com usuários, salas e Master."
        actions={
          <div className="flex gap-2">
            <NewConversationDialog onCreated={(id) => { loadConvs(); setActive(id); }} />
            {role === "master" && <MasterSettingsDialog />}
          </div>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-220px)]">
        {/* Lista */}
        <div className="border rounded-lg flex flex-col bg-card">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar..." className="pl-8 h-9" />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {filteredConvs.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">Sem conversas ainda.</div>
            )}
            {filteredConvs.map(c => {
              const lbl = convLabel(c);
              let name = lbl.name;
              if (c.type === "direct") {
                const oid = directOthers[c.id];
                if (oid) name = profilesMap[oid]?.nome ?? "Conversa";
              }
              return (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 border-b hover:bg-accent/50 transition-colors flex gap-2 items-start",
                    activeId === c.id && "bg-accent"
                  )}
                >
                  <div className="size-8 rounded-full bg-muted grid place-items-center shrink-0">{lbl.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium truncate">{name}</div>
                      {c.last_message_at && <span className="text-[10px] text-muted-foreground shrink-0">{formatDateTime(c.last_message_at)}</span>}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="text-xs text-muted-foreground truncate">{c.last_message_body ?? "—"}</div>
                      {c.unread_count > 0 && (
                        <Badge className="bg-destructive text-destructive-foreground h-5 min-w-5 px-1.5 text-[10px]">{c.unread_count}</Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </ScrollArea>
        </div>

        {/* Conversa */}
        <div className="border rounded-lg flex flex-col bg-card min-w-0">
          {!active ? (
            <div className="flex-1 grid place-items-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="size-10 mx-auto mb-2 opacity-50" />
                Selecione uma conversa
              </div>
            </div>
          ) : (
            <>
              <div className="p-3 border-b flex items-center gap-3">
                <div className="size-9 rounded-full bg-muted grid place-items-center">{convLabel(active).icon}</div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {active.type === "direct"
                      ? (directOthers[active.id] ? profilesMap[directOthers[active.id]]?.nome : "Conversa")
                      : convLabel(active).name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {active.type === "sala" ? "Conversa de sala" : active.type === "master" ? "Conversa com Master" : "Conversa direta"}
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 p-4" ref={scrollRef as any}>
                <div className="space-y-3">
                  {messages.map(m => {
                    const mine = m.sender_id === user?.id;
                    const prof = profilesMap[m.sender_id];
                    return (
                      <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div className={cn("max-w-[75%] rounded-lg px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                          {!mine && <div className="text-[10px] font-semibold opacity-80 mb-0.5">{prof?.nome ?? "Usuário"}</div>}
                          {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                          {m.attachment_path && (
                            <button onClick={() => downloadAttachment(m)} className="mt-1 flex items-center gap-1.5 underline text-xs opacity-90 hover:opacity-100">
                              <Download className="size-3" /> {m.attachment_name}
                            </button>
                          )}
                          <div className={cn("text-[10px] mt-1 opacity-70", mine ? "text-right" : "")}>{formatDateTime(m.created_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {messages.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">Sem mensagens. Diga olá 👋</div>}
                </div>
              </ScrollArea>

              <div className="p-3 border-t flex gap-2 items-end">
                <input ref={fileRef} type="file" className="hidden" onChange={handleFile} accept="image/*,application/pdf" />
                <Button variant="outline" size="icon" onClick={() => fileRef.current?.click()} title="Anexar PDF/imagem">
                  <Paperclip className="size-4" />
                </Button>
                <Textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Digite uma mensagem..."
                  className="min-h-[44px] max-h-32 resize-none"
                  rows={1}
                />
                <Button onClick={handleSend} disabled={sending || !body.trim()}>
                  <Send className="size-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NewConversationDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const { user, role, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; nome: string; email: string; sala_id: string | null }[]>([]);
  const [salas, setSalas] = useState<{ id: string; nome: string }[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    supabase.from("profiles").select("id, nome, email, sala_id").then(({ data }) => setUsers(data ?? []));
    supabase.from("salas").select("id, nome").order("nome").then(({ data }) => setSalas(data ?? []));
  }, [open]);

  const startDirect = async (otherId: string) => {
    const { data, error } = await supabase.rpc("get_or_create_direct_conversation", { _other: otherId });
    if (error) { toast.error(error.message); return; }
    onCreated(data as string); setOpen(false);
  };
  const startSala = async (sid: string) => {
    const { data, error } = await supabase.rpc("get_or_create_sala_conversation", { _sala: sid });
    if (error) { toast.error(error.message); return; }
    onCreated(data as string); setOpen(false);
  };
  const startMaster = async () => {
    const { data, error } = await supabase.rpc("get_or_create_master_conversation", {});
    if (error) { toast.error(error.message); return; }
    onCreated(data as string); setOpen(false);
  };

  const filteredUsers = users.filter(u => u.id !== user?.id && (u.nome.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())));
  const filteredSalas = salas.filter(s => s.nome.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-4" /> Nova conversa</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Iniciar conversa</DialogTitle></DialogHeader>
        <Input placeholder="Buscar usuário ou sala..." value={search} onChange={e => setSearch(e.target.value)} />
        <Tabs defaultValue="users">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="users">Usuários</TabsTrigger>
            <TabsTrigger value="salas">Salas</TabsTrigger>
            {role !== "master" && <TabsTrigger value="master">Master</TabsTrigger>}
          </TabsList>
          <TabsContent value="users">
            <ScrollArea className="h-72">
              {filteredUsers.map(u => (
                <button key={u.id} onClick={() => startDirect(u.id)} className="w-full text-left px-3 py-2 hover:bg-accent rounded flex items-center gap-2">
                  <UserIcon className="size-4" />
                  <div className="flex-1"><div className="font-medium">{u.nome}</div><div className="text-xs text-muted-foreground">{u.email}</div></div>
                </button>
              ))}
              {filteredUsers.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Nenhum usuário</div>}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="salas">
            <ScrollArea className="h-72">
              {filteredSalas.map(s => (
                <button key={s.id} onClick={() => startSala(s.id)} className="w-full text-left px-3 py-2 hover:bg-accent rounded flex items-center gap-2">
                  <Building2 className="size-4" /> <span>{s.nome}</span>
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
