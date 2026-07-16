import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Tag, Building2, Package } from "lucide-react";
import type { Categoria } from "@/lib/types";

const UNIDADES_PRESET = ["Unidade", "Caixa", "Fardo", "Pacote", "Kit", "Litro", "Galão", "Rolo", "Par", "Metro"];

type CatalogoItem = {
  id: string;
  nome: string;
  descricao: string | null;
  unidade_padrao: string;
  categoria_id: string | null;
  ativo: boolean;
  categoria?: { id: string; nome: string } | null;
  salas_count?: number;
};

/**
 * Catálogo = identidade compartilhada de cada item entre as salas.
 * É a base do sistema de EMPRÉSTIMOS: o solicitante escolhe um item do
 * catálogo e o sistema mostra em quais salas ele está disponível.
 * Por isso o catálogo permanece, agora como aba dentro do Controle de Estoque.
 */
export default function CatalogoTab() {
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [filtroCat, setFiltroCat] = useState<string>("all");
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogoItem | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", unidade_padrao: "Unidade", categoria_id: "", ativo: true });
  const [saving, setSaving] = useState(false);

  const [novaCatOpen, setNovaCatOpen] = useState(false);
  const [novaCatNome, setNovaCatNome] = useState("");
  const [novaCatSaving, setNovaCatSaving] = useState(false);

  const load = async () => {
    const [{ data: cat }, { data: c }, { data: p }] = await Promise.all([
      supabase.from("produtos_catalogo").select("id, nome, descricao, unidade_padrao, categoria_id, ativo, categoria:categorias(id, nome)").order("nome"),
      supabase.from("categorias").select("*").order("nome"),
      supabase.from("produtos").select("catalogo_id"),
    ]);
    setCategorias((c as Categoria[]) ?? []);
    const contagem = new Map<string, number>();
    ((p as any[]) ?? []).forEach((row) => {
      const key = row.catalogo_id as string | null;
      if (key) contagem.set(key, (contagem.get(key) ?? 0) + 1);
    });
    setCatalogo(((cat as any[]) ?? []).map((r) => ({ ...r, salas_count: contagem.get(r.id) ?? 0 })));
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ nome: "", descricao: "", unidade_padrao: "Unidade", categoria_id: "", ativo: true });
    setEditOpen(true);
  };
  const openEdit = (item: CatalogoItem) => {
    setEditing(item);
    setForm({
      nome: item.nome,
      descricao: item.descricao ?? "",
      unidade_padrao: item.unidade_padrao ?? "Unidade",
      categoria_id: item.categoria_id ?? "",
      ativo: item.ativo,
    });
    setEditOpen(true);
  };

  const salvar = async () => {
    const nome = form.nome.trim();
    if (!nome) return toast.error("Nome obrigatório");
    setSaving(true);
    const payload: any = {
      nome,
      descricao: form.descricao?.trim() || null,
      unidade_padrao: (form.unidade_padrao || "Unidade").trim(),
      categoria_id: form.categoria_id || null,
      ativo: form.ativo,
    };
    let error;
    if (editing) ({ error } = await supabase.from("produtos_catalogo").update(payload).eq("id", editing.id));
    else ({ error } = await supabase.from("produtos_catalogo").insert(payload));
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Item do catálogo atualizado" : "Item adicionado ao catálogo");
    setEditOpen(false);
    load();
  };

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

  const lista = useMemo(() => catalogo
    .filter((c) => (mostrarInativos ? true : c.ativo))
    .filter((c) => filtroCat === "all" || c.categoria_id === filtroCat),
    [catalogo, filtroCat, mostrarInativos]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground max-w-2xl">
          O <strong>Catálogo</strong> define a identidade de cada item (ex.: "Água sem gás") e é a base dos
          <strong> empréstimos entre salas</strong>. Cada item aparece uma vez aqui, independente de em quantas salas exista.
          O estoque, custo e mínimos de cada sala ficam na aba "Estoque por sala".
        </p>
        <Button onClick={openNew}><Plus className="size-4" /> Novo item</Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground mr-1">Categoria:</span>
        <Button size="sm" variant={filtroCat === "all" ? "default" : "outline"} onClick={() => setFiltroCat("all")}>Todas</Button>
        {categorias.map((c) => (
          <Button key={c.id} size="sm" variant={filtroCat === c.id ? "default" : "outline"} onClick={() => setFiltroCat(c.id)}>
            <Tag className="size-3" /> {c.nome}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Checkbox id="cat-inativos" checked={mostrarInativos} onCheckedChange={(v) => setMostrarInativos(!!v)} />
          <label htmlFor="cat-inativos" className="cursor-pointer text-muted-foreground">Mostrar inativos</label>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="w-[160px]">Categoria</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-[110px]">Unidade padrão</TableHead>
              <TableHead className="w-[110px] text-right">Salas</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[100px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((c) => (
              <TableRow key={c.id} className={`table-row-hover ${!c.ativo ? "opacity-60" : ""}`}>
                <TableCell className="font-medium">{c.nome}</TableCell>
                <TableCell>
                  {c.categoria
                    ? <Badge variant="secondary" className="gap-1"><Tag className="size-3" /> {c.categoria.nome}</Badge>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-md truncate">{c.descricao ?? "—"}</TableCell>
                <TableCell>{c.unidade_padrao}</TableCell>
                <TableCell className="text-right font-mono">
                  <Badge variant="outline" className="gap-1"><Building2 className="size-3" /> {c.salas_count ?? 0}</Badge>
                </TableCell>
                <TableCell>
                  {c.ativo
                    ? <Badge className="bg-success/15 text-success border border-success/30">Ativo</Badge>
                    : <Badge className="bg-muted text-muted-foreground border">Inativo</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" aria-label="Editar item" onClick={() => openEdit(c)}>
                    <Pencil className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {lista.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                <Package className="size-6 mx-auto mb-2 opacity-40" /> Nenhum item no catálogo.
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Editar / Criar item do Catálogo */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar item do catálogo" : "Novo item do catálogo"}</DialogTitle>
            <DialogDescription>
              Define a <strong>identidade</strong> do item. O nome sincroniza com o produto em todas as salas.
              Estoque, custo e mínimos são definidos por sala na aba "Estoque por sala".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Água sem gás" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Categoria</Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setNovaCatNome(""); setNovaCatOpen(true); }}>
                  <Plus className="size-3" /> Nova categoria
                </Button>
              </div>
              <Select value={form.categoria_id || "__none"} onValueChange={(v) => setForm({ ...form, categoria_id: v === "__none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Sem categoria —</SelectItem>
                  {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Unidade padrão</Label>
              <Select
                value={UNIDADES_PRESET.includes(form.unidade_padrao) ? form.unidade_padrao : "__custom"}
                onValueChange={(v) => setForm({ ...form, unidade_padrao: v === "__custom" ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {UNIDADES_PRESET.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  <SelectItem value="__custom">Outros (personalizado)</SelectItem>
                </SelectContent>
              </Select>
              {!UNIDADES_PRESET.includes(form.unidade_padrao) && (
                <Input value={form.unidade_padrao} onChange={(e) => setForm({ ...form, unidade_padrao: e.target.value })} placeholder="Digite a unidade (ex: Bobina)" />
              )}
            </div>
            {editing && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Item ativo no catálogo</div>
                  <div className="text-xs text-muted-foreground">Inativos deixam de aparecer em novas operações, mas continuam no histórico.</div>
                </div>
                <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Criar categoria inline */}
      <Dialog open={novaCatOpen} onOpenChange={setNovaCatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova categoria</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={novaCatNome} onChange={(e) => setNovaCatNome(e.target.value)} placeholder="Ex: Bar, Limpeza, Eventos…" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") criarCategoriaInline(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaCatOpen(false)}>Cancelar</Button>
            <Button onClick={criarCategoriaInline} disabled={novaCatSaving}>{novaCatSaving ? "Criando..." : "Criar e selecionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
