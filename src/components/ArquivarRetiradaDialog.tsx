import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Archive, Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tipo: "requisicao" | "emprestimo";
  onConfirm: (data: { retirado_por: string; retirado_em: string }) => Promise<void> | void;
};

function todayISO() {
  const d = new Date();
  // formato YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

export default function ArquivarRetiradaDialog({ open, onOpenChange, tipo, onConfirm }: Props) {
  const [nome, setNome] = useState("");
  const [data, setData] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNome("");
      setData(todayISO());
      setSaving(false);
    }
  }, [open]);

  const submit = async () => {
    const n = nome.trim();
    if (!n) return;
    if (!data) return;
    setSaving(true);
    try {
      // converte date local em ISO (00:00 local)
      const iso = new Date(`${data}T12:00:00`).toISOString();
      await onConfirm({ retirado_por: n, retirado_em: iso });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="size-5" /> Arquivar {tipo === "requisicao" ? "requisição" : "empréstimo"}
          </DialogTitle>
          <DialogDescription>
            Para arquivar, registre quem retirou fisicamente o pedido e em que data. Essas informações aparecem no histórico, relatórios e PDF.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Nome de quem retirou *</Label>
            <Input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome completo"
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label>Data da retirada *</Label>
            <Input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              max={todayISO()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !nome.trim() || !data}>
            {saving && <Loader2 className="size-4 animate-spin" />} Arquivar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
