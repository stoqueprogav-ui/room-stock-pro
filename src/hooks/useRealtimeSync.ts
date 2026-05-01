import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to one or more Supabase tables and call `onChange` (debounced)
 * whenever any INSERT/UPDATE/DELETE happens. Used to keep dashboard and
 * estoque sempre sincronizados com a "fonte única de verdade".
 */
export function useRealtimeSync(
  tables: string[],
  onChange: () => void,
  opts: { debounceMs?: number; channelName?: string } = {}
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    const debounceMs = opts.debounceMs ?? 250;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), debounceMs);
    };

    const name = opts.channelName ?? `rt-sync-${tables.join("-")}-${Math.random().toString(36).slice(2, 8)}`;
    let channel = supabase.channel(name);
    for (const t of tables) {
      channel = channel.on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: t },
        () => trigger()
      );
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), opts.debounceMs, opts.channelName]);
}
