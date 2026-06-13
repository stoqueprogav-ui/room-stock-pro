// Lightweight IndexedDB wrapper for local form drafts (auto-save).
// No external deps. All drafts are scoped per user and per "scope" key.

export type DraftRecord = {
  id: string; // `${userId}::${scope}`
  userId: string;
  scope: string;
  payload: any;
  updatedAt: number;
  itemCount?: number;
  label?: string; // human readable, e.g. "Nova requisição"
};

const DB_NAME = "rsp_drafts";
const STORE = "drafts";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("by_user", "userId", { unique: false });
        os.createIndex("by_scope", "scope", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function keyFor(userId: string, scope: string) {
  return `${userId}::${scope}`;
}

export async function saveDraft(
  userId: string,
  scope: string,
  payload: any,
  meta?: { itemCount?: number; label?: string }
): Promise<void> {
  const store = await txStore("readwrite");
  const rec: DraftRecord = {
    id: keyFor(userId, scope),
    userId,
    scope,
    payload,
    updatedAt: Date.now(),
    itemCount: meta?.itemCount,
    label: meta?.label,
  };
  await req(store.put(rec));
}

export async function getDraft(userId: string, scope: string): Promise<DraftRecord | null> {
  const store = await txStore("readonly");
  const r = await req<DraftRecord | undefined>(store.get(keyFor(userId, scope)));
  return r ?? null;
}

export async function deleteDraft(userId: string, scope: string): Promise<void> {
  const store = await txStore("readwrite");
  await req(store.delete(keyFor(userId, scope)));
}

export async function listDrafts(userId: string): Promise<DraftRecord[]> {
  const store = await txStore("readonly");
  const idx = store.index("by_user");
  const out: DraftRecord[] = [];
  return new Promise((resolve, reject) => {
    const cur = idx.openCursor(IDBKeyRange.only(userId));
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve(out.sort((a, b) => b.updatedAt - a.updatedAt));
      out.push(c.value as DraftRecord);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

function req<T = any>(r: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}

// Route map: from scope prefix to app route
export function routeForScope(scope: string): string {
  if (scope.startsWith("requisicao:new")) return "/app/nova-requisicao";
  if (scope.startsWith("requisicao:edit:")) return "/app/minhas-requisicoes";
  if (scope.startsWith("emprestimo:new")) return "/app/novo-emprestimo";
  if (scope.startsWith("emprestimo:edit:")) return "/app/emprestimos";
  return "/app";
}

export function labelForScope(scope: string): string {
  if (scope.startsWith("requisicao:new")) return "Nova requisição";
  if (scope.startsWith("requisicao:edit:")) return "Edição de requisição";
  if (scope.startsWith("emprestimo:new")) return "Novo empréstimo";
  if (scope.startsWith("emprestimo:edit:")) return "Edição de empréstimo";
  if (scope.startsWith("devolucao:")) return "Devolução";
  if (scope.startsWith("consumo:")) return "Consumo interno";
  if (scope.startsWith("produto:")) return "Cadastro de produto";
  if (scope.startsWith("inventario:")) return "Inventário";
  if (scope.startsWith("aprovacao:")) return "Aprovação";
  if (scope.startsWith("rejeicao:")) return "Rejeição";
  return scope;
}
