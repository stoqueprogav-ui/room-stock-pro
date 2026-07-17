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
  const [saving, setSaving] = useState(false);
  const [sugestoes, setSugestoes] = useState<Array<{ id: string; nome: string }>>([]);
  const [showSugestoes, setShowSugestoes] = useState(false);
  const [pickedFromCatalogo, setPickedFromCatalogo] = useState(false);
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
    setSugestoes([]);
    setShowSugestoes(false);
    setPickedFromCatalogo(false);
  };

  const reset = () => {
    setForm({ nome: "", descricao: "", unidade: "Unidade", estoque_minimo: 0, custo_unitario: 0, categoria_id: "" });
    setSalaUnica(salaPadrao ?? "");
    setQtdInicial(0);
  };

  const salvar = async () => {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    if (!form.categoria_id) return toast.error("Categoria obrigatória");
    if (!salaUnica) return toast.error("Selecione a sala vinculada ao produto");

    setSaving(true);
    const payload: any = {
      nome: form.nome.trim(),
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
      if (msg.includes("uniq_produtos_catalogo_sala") || msg.includes("produtos_nome_sala") || (msg.includes("duplicate") && msg.includes("nome"))) {
        return toast.error("Já existe um produto com este nome nesta sala.");
      }
      return toast.error(error?.message ?? "Erro ao criar produto");
    }

    if (Number(qtdInicial) > 0) {
      const { error: e2 } = await supabase.rpc("ajustar_estoque", {
        _produto: novo.id, _sala: salaUnica,
        _quantidade: Number(qtdInicial), _observacao: "Estoque inicial no cadastro",
      });
      if (e2) toast.error(`Produto criado, mas falhou o ajuste inicial: ${e2.message}`);
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
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            <p className="text-xs text-muted-foreground">O item é vinculado automaticamente ao catálogo (usado pelos empréstimos). Se o nome já existir no catálogo, ele reaproveita a mesma identidade.</p>
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
            <div className="space-y-2">
              <Label>Quantidade inicial</Label>
              <Input type="number" min={0} value={qtdInicial} onChange={(e) => setQtdInicial(Number(e.target.value))} />
            </div>
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
