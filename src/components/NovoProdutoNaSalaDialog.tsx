import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { Sala, Categoria } from "@/lib/types";

const UNIDADES_PRESET = ["Unidade", "Caixa", "Fardo", "Pacote", "Kit", "Litro", "Galão", "Rolo", "Par", "Metro"];

/**
 * Criar um produto vinculado a UMA sala. Ao inserir em `produtos`, o gatilho
 * trg_produto_auto_catalogo cria/vincula automaticamente o item no catálogo
 * (identidade compartilhada usada pelos empréstimos). A quantidade inicial,
 * se > 0, entra via ajustar_estoque.
 */
export default function NovoProdutoNaSalaDialog({
  open, onOpenChange, salas, categorias, salaPadrao, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  salas: Sala[];
  categorias: Categoria[];
  salaPadrao?: string | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    nome: "", descricao: "", unidade: "Unidade",
    estoque_minimo: 0, custo_unitario: 0, categoria_id: "",
  });
  const [salaUnica, setSalaUnica] = useState<string>(salaPadrao ?? "");
  const [qtdInicial, setQtdInicial] = useState<number>(0);
  const [validadeInicial, setValidadeInicial] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [sugestoes, setSugestoes] = useState<Array<{ id: string; nome: string }>>([]);
  const [showSugestoes, setShowSugestoes] = useState(false);
  const [pickedFromCatalogo, setPickedFromCatalogo] = useState(false);
  const [existenteInativo, setExistenteInativo] = useState<{ produtoId: string; nome: string } | null>(null);
  const [reativando, setReativando] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

  useEffect(() => {
    if (pickedFromCatalogo) return;
    const q = form.nome.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) { setSugestoes([]); return; }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("produtos_catalogo")
        .select("id, nome")
        .ilike("nome", `%${q}%`)
        .order("nome")
        .limit(8);
      setSugestoes((data ?? []) as Array<{ id: string; nome: string }>);
    }, 200);
  }, [form.nome, pickedFromCatalogo]);

  const escolherSugestao = (s: { id: string; nome: string }) => {
    setForm((f) => ({ ...f, nome: s.nome }));
    setPickedFromCatalogo(true);
    setShowSugestoes(false);
  };

  const reset = () => {
    setForm({ nome: "", descricao: "", unidade: "Unidade", estoque_minimo: 0, custo_unitario: 0, categoria_id: "" });
    setSalaUnica(salaPadrao ?? "");
    setQtdInicial(0);
    setValidadeInicial("");
    setSugestoes([]);
    setShowSugestoes(false);
    setPickedFromCatalogo(false);
    setExistenteInativo(null);
  };

  const reativarExistente = async () => {
    if (!existenteInativo) return;
    setReativando(true);
    const { error } = await (supabase as any).rpc("toggle_produto_sala_ativo", {
      _produto_id: existenteInativo.produtoId, _sala_id: salaUnica, _ativo: true,
    });
    setReativando(false);
    if (error) return toast.error(error.message);
    toast.success("Produto reativado nesta sala");
    reset();
    onOpenChange(false);
    onDone();
  };

  const salvar = async () => {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    if (!form.categoria_id) return toast.error("Categoria obrigatória");
    if (!salaUnica) return toast.error("Selecione a sala vinculada ao produto");

    setSaving(true);
    setExistenteInativo(null);

    let nomeFinal = form.nome.trim();
    if (!pickedFromCatalogo) {
      const alvo = normalize(nomeFinal);
      if (alvo.length > 0) {
        const { data: existentes } = await supabase
          .from("produtos_catalogo")
          .select("id, nome");
        const match = (existentes ?? []).find((c: any) => normalize(c.nome) === alvo);
        if (match) nomeFinal = match.nome;
      }
    }

    const payload: any = {
      nome: nomeFinal,
      descricao: form.descricao || null,
      unidade: (form.unidade || "Unidade").trim(),
      estoque_minimo: Number(form.estoque_minimo) || 0,
      custo_unitario: Number(form.custo_unitario) || 0,
      categoria_id: form.categoria_id,
      sala_id: salaUnica,
    };

    const { data: novo, error } = await supabase.from("produtos").insert(payload).select("id").single();
    if (error || !novo) {
      setSaving(false);
      const msg = (error?.message ?? "").toLowerCase();
      const isDup = msg.includes("uniq_produtos_catalogo_sala") || msg.includes("produtos_nome_sala") || (msg.includes("duplicate") && msg.includes("nome"));
      if (isDup) {
        const alvo = normalize(nomeFinal);
        const { data: prods } = await supabase
          .from("produtos")
          .select("id, nome")
          .eq("sala_id", salaUnica)
          .eq("ativo", true);
        const existente = (prods ?? []).find((p: any) => normalize(p.nome) === alvo);
        if (existente) {
          setExistenteInativo({ produtoId: existente.id, nome: existente.nome });
          return;
        }
        return toast.error("Já existe um produto com este nome nesta sala.");
      }
      return toast.error(error?.message ?? "Erro ao criar produto");
    }

    if (Number(qtdInicial) > 0) {
      const { error: e2 } = await supabase.rpc("registrar_entrada_estoque", {
        _produto: novo.id,
        _sala: salaUnica,
        _quantidade: Number(qtdInicial),
        _valor_unitario: Number(form.custo_unitario) || 0,
        _fornecedor: null,
        _numero_nf: null,
        _data_entrada: new Date().toISOString(),
        _observacao: "Estoque inicial no cadastro",
        _validade: validadeInicial || null,
      } as any);
      if (e2) toast.error(`Produto criado, mas falhou a entrada inicial: ${e2.message}`);
    }

    setSaving(false);
    toast.success("Produto criado para a sala");
    reset();
    onOpenChange(false);
    onDone();
  };


  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Novo produto na sala</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Nome *</Label>
            <div className="relative">
              <Input
                value={form.nome}
                onChange={(e) => { setForm({ ...form, nome: e.target.value }); setPickedFromCatalogo(false); setShowSugestoes(true); }}
                onFocus={() => setShowSugestoes(true)}
                onBlur={() => setTimeout(() => setShowSugestoes(false), 150)}
                autoComplete="off"
              />
              {showSugestoes && sugestoes.length > 0 && !pickedFromCatalogo && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-auto">
                  {sugestoes.map((s) => {
                    const exato = normalize(s.nome) === normalize(form.nome);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); escolherSugestao(s); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between gap-2"
                      >
                        <span>{s.nome}</span>
                        {exato && <span className="text-xs text-muted-foreground">já existe</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {pickedFromCatalogo
                ? "Item existente do catálogo selecionado — será reaproveitado (mesma identidade em todas as salas)."
                : "Se o item já existir, escolha na lista para reaproveitar o catálogo. Só crie novo se realmente for um item diferente."}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Categoria *</Label>
            <Select value={form.categoria_id} onValueChange={(v) => setForm({ ...form, categoria_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
              <SelectContent>
                {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Unidade</Label>
              <Select
                value={UNIDADES_PRESET.includes(form.unidade) ? form.unidade : "__custom"}
                onValueChange={(v) => setForm({ ...form, unidade: v === "__custom" ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {UNIDADES_PRESET.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  <SelectItem value="__custom">Outros (personalizado)</SelectItem>
                </SelectContent>
              </Select>
              {!UNIDADES_PRESET.includes(form.unidade) && (
                <Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} placeholder="Digite a unidade (ex: Bobina)" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Estoque mínimo</Label>
              <Input type="number" min={0} value={form.estoque_minimo} onChange={(e) => setForm({ ...form, estoque_minimo: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Custo inicial (R$) <span className="text-muted-foreground text-xs font-normal">— opcional</span></Label>
            <Input type="number" min={0} step="0.01" value={form.custo_unitario}
              onChange={(e) => setForm({ ...form, custo_unitario: Number(e.target.value) })} placeholder="0,00" />
            <p className="text-xs text-muted-foreground">
              A partir daqui, o <strong>Custo Médio Ponderado</strong> da sala é recalculado a cada <strong>Entrada de Estoque</strong>.
            </p>
          </div>
          <div className="space-y-3 pt-3 border-t">
            <div className="space-y-2">
              <Label>Sala vinculada *</Label>
              <Select value={salaUnica} onValueChange={setSalaUnica}>
                <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                <SelectContent>
                  {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Cada sala tem cadastro próprio. Para o mesmo item em outra sala, cadastre novamente ali (o catálogo é reaproveitado).</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Quantidade inicial</Label>
                <Input type="number" min={0} value={qtdInicial} onChange={(e) => setQtdInicial(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Validade <span className="text-muted-foreground text-xs font-normal">— opcional</span></Label>
                <Input type="date" value={validadeInicial} onChange={(e) => setValidadeInicial(e.target.value)} />
              </div>
            </div>
            {Number(qtdInicial) > 0 && (
              <p className="text-xs text-muted-foreground">A quantidade inicial entra como <strong>Entrada de estoque</strong> valorizada pelo custo unitário informado, criando o lote com a validade acima (quando preenchida).</p>
            )}
            {existenteInativo && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-2">
                <div className="text-sm">Este produto já existe nesta sala (inativo). Deseja reativá-lo?</div>
                <div className="text-xs text-muted-foreground">{existenteInativo.nome}</div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={reativarExistente} disabled={reativando}>
                    {reativando ? "Reativando..." : "Reativar este produto"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setExistenteInativo(null)}>Cancelar</Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}><Plus className="size-4" /> {saving ? "Criando..." : "Criar produto"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
