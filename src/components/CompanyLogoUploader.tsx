import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";

export default function CompanyLogoUploader() {
  const { logoUrl, refresh } = useCompanyLogo();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) {
      return toast.error("Use PNG, JPG, WEBP ou SVG");
    }
    if (file.size > 2 * 1024 * 1024) return toast.error("Máximo 2MB");
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("branding")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("branding").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: setErr } = await supabase.from("app_settings")
        .upsert({ key: "logo_url", value: url as any });
      if (setErr) throw setErr;
      await refresh();
      toast.success("Logo atualizado");
    } catch (e: any) {
      toast.error(e.message ?? "Falha no upload");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remover = async () => {
    setBusy(true);
    try {
      await supabase.from("app_settings").upsert({ key: "logo_url", value: "" as any });
      await refresh();
      toast.success("Logo removido");
    } finally { setBusy(false); }
  };

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-16 rounded-md border bg-muted/30 grid place-items-center overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo da empresa" className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1">
          <div className="font-medium">Logo da empresa</div>
          <p className="text-xs text-muted-foreground">PNG, JPG, WEBP ou SVG · até 2MB · aparece no login e no topo do sistema.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {logoUrl ? "Substituir" : "Enviar logo"}
        </Button>
        {logoUrl && (
          <Button variant="ghost" onClick={remover} disabled={busy}>
            <Trash2 className="size-4 text-destructive" /> Remover
          </Button>
        )}
      </div>
    </div>
  );
}
