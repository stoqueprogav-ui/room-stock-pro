import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Globe2, ChevronsUpDown, Check, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { Sala } from "@/lib/types";

export default function MasterScopeSwitcher() {
  const { scopeSalaId, setScope } = useMasterScope();
  const navigate = useNavigate();
  const [salas, setSalas] = useState<Sala[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.from("salas").select("*").order("nome").then(({ data }) => {
      setSalas((data as Sala[]) ?? []);
    });
  }, [scopeSalaId]);

  const atual = scopeSalaId === null ? null : salas.find((s) => s.id === scopeSalaId);
  const label = scopeSalaId === null ? "Todas as salas" : (atual?.nome ?? "Selecionar sala");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 max-w-[260px]">
          {scopeSalaId === null
            ? <Globe2 className="size-4 text-primary shrink-0" />
            : <Building2 className="size-4 text-primary shrink-0" />}
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Buscar sala…" />
          <CommandList>
            <CommandEmpty>Nenhuma sala.</CommandEmpty>
            <CommandGroup heading="Modo">
              <CommandItem
                onSelect={() => { setScope(null); setOpen(false); }}
                className="gap-2"
              >
                <Globe2 className="size-4 text-primary" />
                <span className="flex-1">Todas as salas (global)</span>
                <Check className={cn("size-4", scopeSalaId === null ? "opacity-100" : "opacity-0")} />
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Salas">
              {salas.map((s) => (
                <CommandItem
                  key={s.id}
                  onSelect={() => { setScope(s.id); setOpen(false); }}
                  className="gap-2"
                >
                  <Building2 className="size-4 text-accent" />
                  <span className="flex-1 truncate">{s.nome}</span>
                  <Check className={cn("size-4", scopeSalaId === s.id ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => { setOpen(false); navigate("/app/escolher-sala"); }}
                className="gap-2"
              >
                <Plus className="size-4" />
                <span>Tela de seleção / criar sala</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
