import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, Globe2, Building2, RotateCcw, FileSpreadsheet, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { Produto, Sala, Categoria } from "@/lib/types";
import ImportarProdutosDialog from "@/components/ImportarProdutosDialog";

const UNIDADES_PRESET = ["Unidade", "Caixa", "Fardo", "Pacote", "Kit", "Litro", "Galão", "Rolo", "Par", "Metro"];

type SalaQty = { sala_id: string; selected: boolean; quantidade: number };
type Escopo = "global" | "sala";

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Produto | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", unidade: "Unidade", estoque_minimo: 0, custo_unitario: 0, categoria_id: "", ativo: true, sala_id: "" as string });

  // Escopo do produto
  const [escopo, setEscopo] = useState<Escopo>("global");
  const [salaUnica, setSalaUnica] = useState<string>("");
  const [qtdInicialSala, setQtdInicialSala] = useState<number>(0);
  const [salasQty, setSalasQty] = useState<SalaQty[]>([]);

  const [filtroCat, setFiltroCat] = useState<string>("all");
  const [mostrarInativos, setMostrarInativos] = useState(false);

  // Confirmação de exclusão
  const [confirmDel, setConfirmDel] = useState<Produto | null>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Criação inline de categoria
  const [novaCatOpen, setNovaCatOpen] = useState(false);
  const [novaCatNome, setNovaCatNome] = useState("");
  const [novaCatSaving, setNovaCatSaving] = useState(false);

  const criarCategoriaInline = async () => {
    const n = novaCatNome.trim();
    if (!n) return toast.error("Informe o nome da categoria");
    setNovaCatSaving(true);
    const { data, error } = await supabase.from("categorias").insert({ nome: n }).select("id, nome").single();
    setNovaCatSaving(false);
    if (error || !data) return toast.error(error?.message ?? "Falha ao criar categoria");
    setCategorias((prev) => [...prev, data as Categoria].sort((a, b) => a.nome.localeCompare(b.nome)));
    setForm((f) => ({ ...f, categoria_id: data.id }));
    setNovaCatOpen(false);
    toast.success("Categoria criada e selecionada");
  };

  const load = async () => {
    const [{ data: p }, { data: s }, { data: c }] = await Promise.all([
      supabase.from("produtos").select("*, categoria:categorias(id, nome), sala:salas(id, nome)").order("nome"),
      supabase.from("salas").select("*").order("nome"),
      supabase.from("categorias").select("*").order("nome"),
    ]);
    setProdutos((p as any) ?? []);
    setSalas((s as Sala[]) ?? []);
    setCategorias((c as Categoria[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const resetSalasQty = (salasList: Sala[]) => {
    setSalasQty(salasList.map((s) => ({ sala_id: s.id, selected: false, quantidade: 0 })));
  };

  const openNew = () => {
    setEditing(null);
    setForm({ nome: "", descricao: "", unidade: "Unidade", estoque_minimo: 0, custo_unitario: 0, categoria_id: "", ativo: true, sala_id: "" });
    setEscopo("sala");
    setSalaUnica("");
    setQtdInicialSala(0);
    resetSalasQty(salas);
    setOpen(true);
  };
  const openEdit = (p: Produto) => {
    setEditing(p);
    setForm({
      nome: p.nome,
      descricao: p.descricao ?? "",
      unidade: p.unidade,
      estoque_minimo: p.estoque_minimo,
      custo_unitario: Number((p as any).custo_unitario ?? 0),
      categoria_id: p.categoria_id ?? "",
      ativo: p.ativo !== false,
      sala_id: p.sala_id ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    if (!form.categoria_id) return toast.error("Categoria obrigatória");

    const payload: any = {
      nome: form.nome.trim(),
      descricao: form.descricao || null,
      unidade: (form.unidade || "Unidade").trim(),
      estoque_minimo: Number(form.estoque_minimo) || 0,
      custo_unitario: Number(form.custo_unitario) || 0,
      categoria_id: form.categoria_id,
    };

    if (editing) {
      // Edição: sala pode ser alterada, mas é obrigatória (produtos globais não existem mais).
      if (!form.sala_id) return toast.error("Selecione a sala do produto");
      payload.ativo = form.ativo;
      payload.sala_id = form.sala_id;
      const { error } = await supabase.from("produtos").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Produto atualizado");
      setOpen(false); load();
      return;
    }

    // Criação: sala é obrigatória
    if (!salaUnica) {
      return toast.error("Selecione a sala vinculada ao produto");
    }
    payload.sala_id = salaUnica;

    const { data: novo, error } = await supabase
      .from("produtos").insert(payload).select("id").single();
    if (error || !novo) return toast.error(error?.message ?? "Erro ao criar produto");

    if (Number(qtdInicialSala) > 0) {
      const { error: e2 } = await supabase.rpc("ajustar_estoque", {
        _produto: novo.id, _sala: salaUnica,
        _quantidade: Number(qtdInicialSala),
        _observacao: "Estoque inicial no cadastro",
      });
      if (e2) toast.error(`Produto criado, mas falhou ajuste: ${e2.message}`);
    }

    toast.success("Produto criado para a sala");
    setOpen(false); load();
  };

  const confirmarExclusao = async () => {
    if (!confirmDel) return;
    setDelLoading(true);
    const { data, error } = await supabase.rpc("excluir_produto", { _produto: confirmDel.id });
    setDelLoading(false);
    if (error) {
      toast.error(error.message ?? "Não foi possível excluir o produto");
      return;
    }
    const res = (data as any) ?? {};
    if (res.modo === "desativado") {
      toast.success(res.mensagem ?? "Produto desativado");
    } else {
      toast.success(res.mensagem ?? "Produto excluído");
    }
    setConfirmDel(null);
    load();
  };

  // Menu de reativação por sala
  const [reativarFor, setReativarFor] = useState<string | null>(null);
  const [reativarLoading, setReativarLoading] = useState(false);
  const [salasInativas, setSalasInativas] = useState<{ sala_id: string; nome: string }[]>([]);
  const [reativandoSala, setReativandoSala] = useState<string | null>(null);

  const loadSalasInativas = async (produtoId: string, produtoAtivo: boolean) => {
    setReativarLoading(true);
    setSalasInativas([]);
    // Busca TODAS as salas e os vínculos de estoque deste produto.
    // Uma sala é "disponível para reativar" quando o produto global está inativo
    // ou, com o produto global ativo, quando a sala não tem vínculo ativo.
    const [{ data: salasData, error: e1 }, { data: estData, error: e2 }] = await Promise.all([
      supabase.from("salas").select("id, nome").order("nome"),
      supabase.from("estoque").select("sala_id, ativo").eq("produto_id", produtoId),
    ]);
    setReativarLoading(false);
    if (e1) { toast.error(e1.message); return; }
    if (e2) { toast.error(e2.message); return; }
    const ativosBySala = new Map<string, boolean>();
    ((estData as any[]) ?? []).forEach((r) => ativosBySala.set(r.sala_id, !!r.ativo));
    const list = ((salasData as any[]) ?? [])
      .filter((s) => !produtoAtivo || ativosBySala.get(s.id) !== true)
      .map((s) => ({ sala_id: s.id as string, nome: s.nome as string }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    setSalasInativas(list);
  };

  const reativarNaSala = async (produtoId: string, salaId: string) => {
    setReativandoSala(salaId);
    // Verifica se já existe vínculo em estoque para esta sala
    const { data: existente, error: eSel } = await supabase
      .from("estoque")
      .select("id")
      .eq("produto_id", produtoId)
      .eq("sala_id", salaId)
      .maybeSingle();
    if (eSel) {
      setReativandoSala(null);
      return toast.error(eSel.message);
    }

    if (existente) {
      // 1) Reativa o vínculo existente
      const { error: e1 } = await supabase.rpc("toggle_produto_sala_ativo", {
        _produto_id: produtoId, _sala_id: salaId, _ativo: true,
      });
      if (e1) {
        setReativandoSala(null);
        return toast.error(e1.message);
      }
    } else {
      // 1) Cria vínculo de estoque para a sala (quantidade zero, ativo)
      const { error: eIns } = await supabase
        .from("estoque")
        .insert({ produto_id: produtoId, sala_id: salaId, quantidade: 0, ativo: true });
      if (eIns) {
        setReativandoSala(null);
        return toast.error(eIns.message);
      }
    }

    // 2) Garante que o produto global esteja ativo (sem mexer nas outras salas)
    const { error: eUpd } = await supabase.from("produtos").update({ ativo: true }).eq("id", produtoId);
    setReativandoSala(null);
    if (eUpd) return toast.error(eUpd.message);

    toast.success("Produto reativado apenas nesta sala");
    setReativarFor(null);
    load();
  };


  const setQty = (sala_id: string, q: number) => {
    setSalasQty((prev) => prev.map((s) => s.sala_id === sala_id ? { ...s, quantidade: q } : s));
  };

  const lista = useMemo(() => produtos
    .filter((p) => mostrarInativos ? true : (p.ativo !== false))
    .filter((p) => filtroCat === "all" || p.categoria_id === filtroCat),
    [produtos, filtroCat, mostrarInativos]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produtos"
        description="Catálogo. Cada produto pertence a uma sala específica."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="size-4" /> Importar</Button>
            <Button onClick={openNew}><Plus className="size-4" /> Novo produto</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground mr-1">Categoria:</span>
        <Button size="sm" variant={filtroCat === "all" ? "default" : "outline"} onClick={() => setFiltroCat("all")}>
          Todas
        </Button>
        {categorias.map((c) => (
          <Button key={c.id} size="sm" variant={filtroCat === c.id ? "default" : "outline"} onClick={() => setFiltroCat(c.id)}>
            <Tag className="size-3" /> {c.nome}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Checkbox id="inativos" checked={mostrarInativos} onCheckedChange={(v) => setMostrarInativos(!!v)} />
          <label htmlFor="inativos" className="cursor-pointer text-muted-foreground">Mostrar inativos</label>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-[140px]">Sala</TableHead>
              <TableHead className="w-[140px]">Categoria</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-[90px]">Unidade</TableHead>
              <TableHead className="w-[90px] text-right">Mínimo</TableHead>
              <TableHead className="w-[120px] text-right">Custo inicial</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[140px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((p) => {
              const inativo = p.ativo === false;
              return (
                <TableRow key={p.id} className={`table-row-hover ${inativo ? "opacity-60" : ""}`}>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1 border-accent/40 text-accent"><Building2 className="size-3" /> {p.sala?.nome ?? "—"}</Badge>
                  </TableCell>
                  <TableCell>
                    {p.categoria
                      ? <Badge variant="secondary" className="gap-1"><Tag className="size-3" /> {p.categoria.nome}</Badge>
                      : <span className="text-xs text-destructive">— sem categoria</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-md truncate">{p.descricao ?? "—"}</TableCell>
                  <TableCell>{p.unidade}</TableCell>
                  <TableCell className="text-right font-mono text-warning">{p.estoque_minimo}</TableCell>
                  <TableCell className="text-right font-mono">{Number((p as any).custo_unitario ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    {inativo
                      ? <Badge className="bg-muted text-muted-foreground border">Inativo</Badge>
                      : <Badge className="bg-success/15 text-success border border-success/30">Ativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {inativo ? (
                      <DropdownMenu
                        open={reativarFor === p.id}
                        onOpenChange={(o) => {
                          if (o) { setReativarFor(p.id); loadSalasInativas(p.id, p.ativo !== false); }
                          else setReativarFor(null);
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="gap-1">
                            <RotateCcw className="size-4" /> Reativar
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          <DropdownMenuLabel className="text-xs">Reativar em qual sala?</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {reativarLoading && (
                            <div className="px-2 py-3 text-xs text-muted-foreground flex items-center gap-2">
                              <Loader2 className="size-3 animate-spin" /> Carregando salas...
                            </div>
                          )}
                          {!reativarLoading && salasInativas.length === 0 && (
                            <div className="px-2 py-3 text-xs text-muted-foreground">
                              Nenhuma sala inativa para este produto.
                            </div>
                          )}
                          {!reativarLoading && salasInativas.map((s) => (
                            <DropdownMenuItem
                              key={s.sala_id}
                              disabled={reativandoSala === s.sala_id}
                              onSelect={(e) => { e.preventDefault(); reativarNaSala(p.id, s.sala_id); }}
                              className="gap-2"
                            >
                              <Building2 className="size-4 text-accent" />
                              <span className="flex-1">{s.nome}</span>
                              {reativandoSala === s.sala_id && <Loader2 className="size-3 animate-spin" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <>
                        <Button variant="ghost" size="icon" aria-label="Editar produto" onClick={() => openEdit(p)}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" aria-label="Excluir produto" onClick={() => setConfirmDel(p)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>

                </TableRow>
              );
            })}
            {lista.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-12">Nenhum produto.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      {/* Cadastro / Edição */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Nome *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Categoria *</Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                  onClick={() => { setNovaCatNome(""); setNovaCatOpen(true); }}>
                  <Plus className="size-3" /> Nova categoria
                </Button>
              </div>
              <Select value={form.categoria_id} onValueChange={(v) => setForm({ ...form, categoria_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {categorias.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma categoria ainda. Use "+ Nova categoria" para criar.</p>
              )}
            </div>
            <div className="space-y-2"><Label>Descrição</Label><Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Unidade</Label>
                <Select
                  value={UNIDADES_PRESET.includes(form.unidade) ? form.unidade : "__custom"}
                  onValueChange={(v) => {
                    if (v === "__custom") setForm({ ...form, unidade: "" });
                    else setForm({ ...form, unidade: v });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {UNIDADES_PRESET.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    <SelectItem value="__custom">Outros (personalizado)</SelectItem>
                  </SelectContent>
                </Select>
                {!UNIDADES_PRESET.includes(form.unidade) && (
                  <Input
                    value={form.unidade}
                    onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                    placeholder="Digite a unidade (ex: Bobina)"
                  />
                )}
              </div>
              <div className="space-y-2"><Label>Estoque mínimo</Label><Input type="number" min={0} value={form.estoque_minimo} onChange={(e) => setForm({ ...form, estoque_minimo: Number(e.target.value) })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Custo inicial (R$) <span className="text-muted-foreground text-xs font-normal">— opcional</span></Label>
              <Input type="number" min={0} step="0.01" value={form.custo_unitario}
                onChange={(e) => setForm({ ...form, custo_unitario: Number(e.target.value) })}
                placeholder="0,00" />
              <p className="text-xs text-muted-foreground">
                Valor de referência. A partir daqui, o <strong>Custo Médio Ponderado</strong> de cada sala é recalculado automaticamente em cada <strong>Entrada de Estoque</strong> (compra).
              </p>
            </div>

            {editing && (
              <div className="space-y-3 pt-3 border-t">
                <div className="space-y-2">
                  <Label>Sala do produto *</Label>
                  <Select value={form.sala_id} onValueChange={(v) => setForm({ ...form, sala_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                    <SelectContent>
                      {salas.map((s) => <SelectItem key={s.id} value={s.id}>🏢 {s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Cada sala tem seu próprio cadastro de produtos, com estoques, custos e histórico independentes.</p>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Produto ativo</div>
                    <div className="text-xs text-muted-foreground">Desativados não aparecem em novas requisições, mas continuam no histórico.</div>
                  </div>
                  <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
                </div>
              </div>
            )}

            {!editing && (
              <div className="space-y-3 pt-3 border-t">
                <div className="space-y-2">
                  <Label>Sala vinculada *</Label>
                  <Select value={salaUnica} onValueChange={setSalaUnica}>
                    <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                    <SelectContent>
                      {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Cada sala tem cadastro próprio. Para o mesmo produto em outras salas, cadastre novamente ali.</p>
                </div>
                <div className="space-y-2">
                  <Label>Quantidade inicial</Label>
                  <Input type="number" min={0} value={qtdInicialSala} onChange={(e) => setQtdInicialSala(Number(e.target.value))} />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de inativação/exclusão */}
      <Dialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inativar “{confirmDel?.nome}”?</DialogTitle>
            <DialogDescription>
              Se este produto já teve <span className="font-medium text-foreground">qualquer movimentação</span> —
              entradas, saídas, requisições, empréstimos, devoluções, dívidas, consumos internos, histórico de custos
              ou estoque atual — ele será apenas <span className="font-medium text-foreground">inativado</span> para
              preservar 100% dos relatórios, auditoria e Central Analítica. Assim ele deixa de aparecer em novas
              operações, mas continua no histórico.
              <br /><br />
              A exclusão definitiva só acontece quando o produto <span className="font-medium text-foreground">nunca foi utilizado</span> em nenhuma operação.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarExclusao} disabled={delLoading}>
              {delLoading ? "Processando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Criar categoria inline */}
      <Dialog open={novaCatOpen} onOpenChange={setNovaCatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova categoria</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={novaCatNome}
              onChange={(e) => setNovaCatNome(e.target.value)}
              placeholder="Ex: Bar, Limpeza, Eventos…"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") criarCategoriaInline(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaCatOpen(false)}>Cancelar</Button>
            <Button onClick={criarCategoriaInline} disabled={novaCatSaving}>
              {novaCatSaving ? "Criando..." : "Criar e selecionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportarProdutosDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        salas={salas}
        categorias={categorias}
        produtos={produtos}
        onDone={load}
      />
    </div>
  );
}
