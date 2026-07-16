import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building2, Globe2, Plus, ArrowRight, Loader2, ShieldCheck, MapPin } from "lucide-react";
import { toast } from "sonner";
import type { Sala } from "@/lib/types";

type RegiaoLite = { id: string; nome: string };

export default function EscolherSala() {
  const { profile, isSuperMaster } = useAuth();
  const { isSuperMode, actingRegiaoId, enterSuperMode, enterRegiaoMode, setScope } = useMasterScope();
  const navigate = useNavigate();

  const [salas, setSalas] = useState<Sala[] | null>(null);
  const [minhasRegioes, setMinhasRegioes] = useState<RegiaoLite[]>([]);
  const [novaOpen, setNovaOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [criando, setCriando] = useState(false);

  const load = async () => {
    const [{ data: ss }, { data: mr }] = await Promise.all([
      supabase.from("salas").select("*").order("nome"),
      supabase.from("master_regioes").select("regiao_id, regioes(id, nome)"),
    ]);
    setSalas((ss as Sala[]) ?? []);
    setMinhasRegioes(((mr as any[]) ?? []).map((r) => r.regioes).filter(Boolean));
  };
  useEffect(() => { load(); }, []);

  // Passo de modo aparece só para super master que ainda não escolheu
  const mostrarModo = isSuperMaster && !isSuperMode && !actingRegiaoId;

  const salasDoEscopo = useMemo(
    () => (salas ?? []).filter((s) => !actingRegiaoId || (s as any).regiao_id === actingRegiaoId),
    [salas, actingRegiaoId]
  );

  // Região usada ao criar sala inline
  const regiaoParaNovaSala = actingRegiaoId ?? (minhasRegioes.length === 1 ? minhasRegioes[0].id : null);

  const escolherSala = (salaId: string | null) => {
    setScope(salaId);
    navigate("/app", { replace: true });
  };

  const criarSala = async () => {
    if (!novoNome.trim()) return toast.error("Nome obrigatório");
    if (!regiaoParaNovaSala) return toast.error("Defina a região da sala pela tela de Salas.");
    setCriando(true);
    const { data, error } = await supabase.from("salas")
      .insert({ nome: novoNome.trim(), regiao_id: regiaoParaNovaSala }).select("id").single();
    setCriando(false);
    if (error || !data) return toast.error(error?.message ?? "Erro ao criar sala");
    toast.success("Sala criada");
    setNovaOpen(false); setNovoNome("");
    await load();
    escolherSala(data.id);
  };

  const nomeRegiaoAtual = actingRegiaoId ? minhasRegioes.find((r) => r.id === actingRegiaoId)?.nome : null;

  const Header = (
    <header className="border-b border-border bg-card/60 backdrop-blur">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md bg-gradient-primary grid place-items-center text-primary-foreground">
            <Building2 className="size-5" />
          </div>
          <div>
            <div className="font-display font-bold">Estoque Pro</div>
            <div className="text-xs text-muted-foreground">Painel Master</div>
          </div>
        </div>
        <div className="text-sm text-muted-foreground hidden sm:block">{profile?.email}</div>
      </div>
    </header>
  );

  // ----------------- PASSO 1: escolher o modo (só super master) -----------------
  if (mostrarModo) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {Header}
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 animate-fade-in">
          <div className="text-center space-y-2 mb-8">
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">Como deseja entrar?</h1>
            <p className="text-muted-foreground">Entre como Super Master para gerenciar regiões e masters, ou entre em uma região para operá-la.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card
              onClick={() => { enterSuperMode(); navigate("/app", { replace: true }); }}
              className="stat-card cursor-pointer group border-2 border-primary/40 hover:border-primary transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="size-10 rounded-md bg-primary/10 grid place-items-center text-primary mb-3"><ShieldCheck className="size-5" /></div>
                  <div className="font-display text-lg font-semibold">Super Master</div>
                  <div className="text-sm text-muted-foreground mt-1">Gerenciar regiões, masters e visão consolidada</div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </div>
            </Card>

            {minhasRegioes.map((r) => (
              <Card key={r.id} onClick={() => enterRegiaoMode(r.id)}
                className="stat-card cursor-pointer group hover:border-primary/60 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="size-10 rounded-md bg-muted grid place-items-center text-accent mb-3"><MapPin className="size-5" /></div>
                    <div className="font-display text-lg font-semibold">Master de {r.nome}</div>
                    <div className="text-sm text-muted-foreground mt-1">Operar apenas esta região</div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
              </Card>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // ----------------- PASSO 2: escolher a sala -----------------
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {Header}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 animate-fade-in">
        <div className="text-center space-y-2 mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            {nomeRegiaoAtual ? `Região: ${nomeRegiaoAtual}` : "Selecione a sala que deseja administrar"}
          </h1>
          <p className="text-muted-foreground">Você poderá alternar a qualquer momento no topo do painel.</p>
        </div>

        {salas === null ? (
          <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* "Ver todas" só para master comum (sem região fixada). Super em modo região opera por sala. */}
            {!actingRegiaoId && (
              <Card onClick={() => escolherSala(null)}
                className="stat-card cursor-pointer group border-2 border-primary/30 hover:border-primary transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="size-10 rounded-md bg-primary/10 grid place-items-center text-primary mb-3"><Globe2 className="size-5" /></div>
                    <div className="font-display text-lg font-semibold">Ver todas as salas</div>
                    <div className="text-sm text-muted-foreground mt-1">Modo global consolidado</div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
              </Card>
            )}

            {salasDoEscopo.map((s) => (
              <Card key={s.id} onClick={() => escolherSala(s.id)}
                className="stat-card cursor-pointer group hover:border-primary/60 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="size-10 rounded-md bg-muted grid place-items-center text-accent mb-3"><Building2 className="size-5" /></div>
                    <div className="font-display text-lg font-semibold">{s.nome}</div>
                    <div className="text-sm text-muted-foreground mt-1">Administrar esta sala</div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
              </Card>
            ))}

            {salasDoEscopo.length === 0 && (
              <Card className="stat-card sm:col-span-2 lg:col-span-1 text-sm text-muted-foreground flex items-center justify-center py-8">
                Nenhuma sala nesta região ainda. Crie a primeira abaixo.
              </Card>
            )}

            <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
              <DialogTrigger asChild>
                <Card className="stat-card cursor-pointer group border-dashed hover:border-primary/60 hover:bg-muted/30 transition-colors">
                  <div className="flex flex-col items-center justify-center text-center py-2">
                    <div className="size-10 rounded-md bg-muted grid place-items-center text-primary mb-3"><Plus className="size-5" /></div>
                    <div className="font-display text-lg font-semibold">Criar nova sala</div>
                    <div className="text-sm text-muted-foreground mt-1">{nomeRegiaoAtual ? `Em ${nomeRegiaoAtual}` : "Adicionar um novo estoque"}</div>
                  </div>
                </Card>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Nova sala{nomeRegiaoAtual ? ` — ${nomeRegiaoAtual}` : ""}</DialogTitle></DialogHeader>
                <div className="space-y-2">
                  <Label>Nome da sala</Label>
                  <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex: Almoxarifado Central" />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setNovaOpen(false)}>Cancelar</Button>
                  <Button onClick={criarSala} disabled={criando}>
                    {criando && <Loader2 className="size-4 animate-spin" />} Criar e abrir
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </main>
    </div>
  );
}
