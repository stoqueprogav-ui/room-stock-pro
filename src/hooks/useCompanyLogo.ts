import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

let cached: string | null | undefined;
const listeners = new Set<(v: string | null) => void>();

async function fetchLogo(): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "logo_url").maybeSingle();
  const v = (data?.value as unknown as string) ?? "";
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function useCompanyLogo() {
  const [logoUrl, setLogoUrl] = useState<string | null>(cached ?? null);

  useEffect(() => {
    const handler = (v: string | null) => setLogoUrl(v);
    listeners.add(handler);
    if (cached === undefined) {
      fetchLogo().then((v) => {
        cached = v;
        listeners.forEach((l) => l(v));
      });
    }
    return () => { listeners.delete(handler); };
  }, []);

  const refresh = useCallback(async () => {
    const v = await fetchLogo();
    cached = v;
    listeners.forEach((l) => l(v));
  }, []);

  return { logoUrl, refresh };
}
