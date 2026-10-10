import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  migrateInvoice,
  uid,
  type Business,
  type EwbRecord,
  type GstSnapshot,
  type Invoice,
  type Party,
  type Product,
  type Transporter,
} from '@/lib/domain';
import { api, ApiError, setApiIdentity, type Plan, type ServiceConfig, type Subscription, type SyncEnvelope, type WalletSummary } from '@/lib/api';
import { useAuth } from '@/state/auth';

/**
 * Local-first workspace store. Drafts and saved details persist on the device
 * immediately and sync to the backend when online (last write wins per
 * record). E-way bills and GST status are owned by the backend; the device
 * keeps a timestamped cache for offline viewing only.
 */

type SyncState = 'idle' | 'syncing' | 'offline' | 'error';
type Collections = 'invoices' | 'parties' | 'products' | 'transporters';
type Persisted = {
  business: Business | null;
  invoices: Invoice[];
  parties: Party[];
  products: Product[];
  transporters: Transporter[];
  activeGstin: string;
  ewbs: EwbRecord[];
  ewbsFetchedAt: string | null;
  gstCache: Record<string, { snapshots: GstSnapshot[]; fetchedAt: string }>;
  lastSyncAt: string | null;
  tombstones: Record<string, Record<string, string>>;
};

type StoreValue = Omit<Persisted, 'tombstones'> & {
  isHydrated: boolean;
  previewOnly: boolean;
  storageError: string;
  workspaceId: string | null;
  online: boolean | null;
  syncState: SyncState;
  config: ServiceConfig | null;
  subscription: { subscription: Subscription; plan: Plan; plans: Plan[]; plansAreSamples: boolean; billingMode: string } | null;
  saveBusiness: (business: Business) => Promise<void>;
  setActiveGstin: (gstin: string) => Promise<void>;
  saveInvoice: (invoice: Invoice) => Promise<void>;
  removeInvoice: (invoiceId: string) => Promise<void>;
  saveParty: (party: Omit<Party, 'id' | 'updatedAt'> & { id?: string }) => Promise<Party>;
  removeParty: (id: string) => Promise<void>;
  saveProduct: (product: Omit<Product, 'id' | 'updatedAt'> & { id?: string }) => Promise<Product>;
  removeProduct: (id: string) => Promise<void>;
  saveTransporter: (transporter: Omit<Transporter, 'id' | 'updatedAt'> & { id?: string }) => Promise<Transporter>;
  removeTransporter: (id: string) => Promise<void>;
  upsertEwb: (ewb: EwbRecord) => void;
  refreshEwbs: () => Promise<void>;
  setGstCache: (key: string, snapshots: GstSnapshot[]) => void;
  refreshServices: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
  /** Credit wallet (balance, costs, history); null until loaded. */
  wallet: WalletSummary | null;
  refreshWallet: () => Promise<void>;
  /** Applies a balance returned by an action without refetching the whole wallet. */
  setWalletBalance: (balance: number | undefined) => void;
  syncNow: () => Promise<void>;
  clearLocalData: () => Promise<void>;
  exportData: () => string;
};

const StoreContext = createContext<StoreValue | null>(null);
const STORE_PREFIX = 'ewb-vendor-v1:';
const EMPTY: Persisted = {
  business: null,
  invoices: [],
  parties: [],
  products: [],
  transporters: [],
  activeGstin: '',
  ewbs: [],
  ewbsFetchedAt: null,
  gstCache: {},
  lastSyncAt: null,
  tombstones: {},
};

async function deviceWorkspaceId() {
  const key = `${STORE_PREFIX}device-workspace`;
  const existing = await AsyncStorage.getItem(key);
  if (existing) return existing;
  const created = `dev${uid()}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  await AsyncStorage.setItem(key, created);
  return created;
}

/** Applies the server's EWB list to invoices so each one links to its bill. */
function linkInvoices(invoices: Invoice[], ewbs: EwbRecord[]) {
  let changed = false;
  const byInvoice = new Map<string, EwbRecord>();
  for (const ewb of ewbs) {
    const current = byInvoice.get(ewb.invoiceId);
    if (!current || (current.status === 'cancelled' && ewb.status !== 'cancelled')) byInvoice.set(ewb.invoiceId, ewb);
  }
  const next = invoices.map((invoice) => {
    const ewb = byInvoice.get(invoice.id);
    if (!ewb) return invoice;
    if (ewb.status === 'cancelled') {
      if (invoice.status === 'ewb_generated' && invoice.ewbId === ewb.id) {
        changed = true;
        return { ...invoice, status: 'ready' as const, ewbId: undefined, ewbNumber: undefined, idempotencyKey: undefined, updatedAt: new Date().toISOString() };
      }
      return invoice;
    }
    if (invoice.ewbId === ewb.id && invoice.status === 'ewb_generated') return invoice;
    changed = true;
    return { ...invoice, status: 'ewb_generated' as const, ewbId: ewb.id, ewbNumber: ewb.ewbNumber, updatedAt: new Date().toISOString() };
  });
  return changed ? next : invoices;
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const { user, previewMode } = useAuth();
  // A pending registration (email not yet verified) never sees workspace data.
  const verifiedUser = user?.verified ? user : null;
  const scope = previewMode ? 'preview' : verifiedUser?.uid ?? null;
  const [data, setData] = useState<Persisted>(EMPTY);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const [storageError, setStorageError] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [config, setConfig] = useState<ServiceConfig | null>(null);
  const [subscription, setSubscription] = useState<StoreValue['subscription']>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const syncing = useRef(false);

  const update = useCallback((fn: (current: Persisted) => Persisted) => setData((current) => fn(current)), []);

  // Identity for API calls: Firebase uid + ID token, or a device workspace in preview.
  useEffect(() => {
    let active = true;
    if (!scope) {
      setWorkspaceId(null);
      setApiIdentity({ workspaceId: null, getToken: null });
      return;
    }
    (async () => {
      const id = verifiedUser ? verifiedUser.uid : await deviceWorkspaceId();
      if (!active) return;
      setWorkspaceId(id);
      setApiIdentity({ workspaceId: id, getToken: verifiedUser ? () => verifiedUser.getIdToken() : null });
    })().catch(() => setStorageError('Could not prepare this device workspace.'));
    return () => {
      active = false;
    };
  }, [scope, verifiedUser]);

  // Hydrate from device storage whenever the signed-in scope changes.
  useEffect(() => {
    let active = true;
    setData(EMPTY);
    setHydratedScope(null);
    setStorageError('');
    setSubscription(null);
    if (!scope) return;
    AsyncStorage.getItem(`${STORE_PREFIX}${scope}`)
      .then((stored) => {
        if (!active) return;
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<Persisted>;
          setData({
            ...EMPTY,
            ...parsed,
            invoices: (parsed.invoices ?? []).map((invoice) => migrateInvoice(invoice)),
            activeGstin: parsed.activeGstin ?? parsed.business?.defaultGstin ?? parsed.business?.gstin ?? '',
          });
        }
        setHydratedScope(scope);
      })
      .catch(() => {
        if (active) {
          setStorageError('Could not read saved details from this device.');
          setHydratedScope(scope);
        }
      });
    return () => {
      active = false;
    };
  }, [scope]);

  // Persist every change.
  useEffect(() => {
    if (!scope || hydratedScope !== scope) return;
    const timer = setTimeout(() => {
      AsyncStorage.setItem(`${STORE_PREFIX}${scope}`, JSON.stringify(data))
        .then(() => setStorageError(''))
        .catch(() => setStorageError('Could not save changes on this device. Check available storage.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [scope, hydratedScope, data]);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.offline) setOnline(false);
  }, []);

  const syncNow = useCallback(async () => {
    if (!workspaceId || syncing.current) return;
    syncing.current = true;
    setSyncState('syncing');
    try {
      const current = dataRef.current;
      const since = current.lastSyncAt ?? undefined;
      const changed = <T extends { id: string; updatedAt: string }>(items: T[]) => items.filter((item) => !since || item.updatedAt > since).map((item) => ({ id: item.id, updatedAt: item.updatedAt, data: item }));
      const collections: Record<string, SyncEnvelope[]> = {
        invoices: changed(current.invoices),
        parties: changed(current.parties),
        products: changed(current.products),
        transporters: changed(current.transporters),
        business: current.business && (!since || (current.business.updatedAt ?? '') > since) ? [{ id: 'profile', updatedAt: current.business.updatedAt ?? new Date(0).toISOString(), data: current.business }] : [],
      };
      for (const [name, ids] of Object.entries(current.tombstones)) {
        for (const [id, at] of Object.entries(ids)) (collections[name] ??= []).push({ id, updatedAt: at, deleted: true });
      }
      const result = await api.sync(since, collections);
      setOnline(true);
      update((state) => {
        let next: Persisted = { ...state, lastSyncAt: result.serverTime, tombstones: {} };
        const merge = <T extends { id: string; updatedAt: string }>(key: Collections, map: (raw: unknown) => T) => {
          const incoming = result.changes[key] ?? [];
          if (!incoming.length) return;
          const list = [...(next[key] as unknown as T[])];
          for (const record of incoming) {
            const index = list.findIndex((item) => item.id === record.id);
            if (record.deleted) {
              if (index >= 0 && list[index]!.updatedAt <= record.updatedAt) list.splice(index, 1);
            } else if (record.data && (index < 0 || list[index]!.updatedAt < record.updatedAt)) {
              if (index >= 0) list[index] = map(record.data);
              else list.push(map(record.data));
            }
          }
          next = { ...next, [key]: list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
        };
        merge<Invoice>('invoices', (raw) => migrateInvoice(raw as Invoice));
        merge<Party>('parties', (raw) => raw as Party);
        merge<Product>('products', (raw) => raw as Product);
        merge<Transporter>('transporters', (raw) => raw as Transporter);
        const remoteBusiness = result.changes.business?.find((item) => item.id === 'profile');
        if (remoteBusiness?.data && (!next.business || (next.business.updatedAt ?? '') < remoteBusiness.updatedAt)) {
          next.business = remoteBusiness.data as Business;
          next.activeGstin = next.activeGstin || next.business.defaultGstin || next.business.gstin;
        }
        // Keep tombstones created while this sync was in flight.
        for (const [name, ids] of Object.entries(dataRef.current.tombstones)) {
          for (const [id, at] of Object.entries(ids)) {
            if (state.tombstones[name]?.[id] !== at) next.tombstones = { ...next.tombstones, [name]: { ...next.tombstones[name], [id]: at } };
          }
        }
        return next;
      });
      setSyncState('idle');
    } catch (error) {
      handleError(error);
      setSyncState(error instanceof ApiError && error.offline ? 'offline' : 'error');
    } finally {
      syncing.current = false;
    }
  }, [handleError, update, workspaceId]);

  const refreshEwbs = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const result = await api.listEwbs();
      setOnline(true);
      update((state) => ({ ...state, ewbs: result.ewbs, ewbsFetchedAt: new Date().toISOString(), invoices: linkInvoices(state.invoices, result.ewbs) }));
    } catch (error) {
      handleError(error);
      throw error;
    }
  }, [handleError, update, workspaceId]);

  const refreshServices = useCallback(async () => {
    try {
      setConfig(await api.config());
      setOnline(true);
    } catch (error) {
      handleError(error);
      setConfig(null);
    }
  }, [handleError]);

  const refreshSubscription = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setSubscription(await api.subscription());
      setOnline(true);
    } catch (error) {
      handleError(error);
    }
  }, [handleError, workspaceId]);

  const refreshWallet = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setWallet(await api.wallet());
      setOnline(true);
    } catch (error) {
      handleError(error);
    }
  }, [handleError, workspaceId]);

  const setWalletBalance = useCallback((balance: number | undefined) => {
    if (typeof balance === 'number') setWallet((current) => (current ? { ...current, balance } : current));
  }, []);

  // Initial online work once hydrated with an identity.
  const ready = Boolean(scope && hydratedScope === scope && workspaceId);
  useEffect(() => {
    if (!ready) return;
    void refreshServices();
    void refreshSubscription();
    void refreshWallet();
    void refreshEwbs().catch(() => undefined);
    void syncNow();
    const subscriptionHandle = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshEwbs().catch(() => undefined);
        void syncNow();
      }
    });
    return () => subscriptionHandle.remove();
  }, [ready, refreshEwbs, refreshServices, refreshSubscription, refreshWallet, syncNow]);

  // Debounced background sync after local edits.
  const syncKey = `${data.invoices.length}:${data.invoices[0]?.updatedAt}:${data.parties.length}:${data.products.length}:${data.transporters.length}:${data.business?.updatedAt}:${Object.keys(data.tombstones).length}`;
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void syncNow(), 2500);
    return () => clearTimeout(timer);
  }, [ready, syncKey, syncNow]);

  const actor = previewMode ? 'local-preview' : user?.uid ?? 'unknown';

  const saveBusiness = useCallback(async (next: Business) => {
    update((state) => ({
      ...state,
      business: { ...next, updatedAt: new Date().toISOString() },
      activeGstin: state.activeGstin || next.defaultGstin || next.gstin || '',
    }));
  }, [update]);

  const saveInvoice = useCallback(async (next: Invoice) => {
    update((state) => {
      const previous = state.invoices.find((item) => item.id === next.id);
      if (!previous) return { ...state, invoices: [{ ...next, createdBy: next.createdBy ?? actor, updatedBy: actor }, ...state.invoices] };
      // A generated bill's invoice is immutable; ignore late writes from a stale editor.
      if (previous.status === 'ewb_generated' && next.status !== 'ewb_generated') return state;
      const strip = ({ updatedAt: _u, createdBy: _c, updatedBy: _b, revisionHistory: _h, ...rest }: Invoice) => rest;
      const changed = JSON.stringify(strip(previous)) !== JSON.stringify(strip(next));
      if (!changed && previous.updatedAt === next.updatedAt) return state;
      const { revisionHistory: oldHistory, ...snapshot } = previous;
      const revisionHistory = changed ? [...(oldHistory ?? []), snapshot].slice(-20) : oldHistory ?? [];
      const merged = { ...next, createdBy: previous.createdBy ?? actor, updatedBy: actor, revisionHistory };
      return { ...state, invoices: [merged, ...state.invoices.filter((item) => item.id !== next.id)] };
    });
  }, [actor, update]);

  const tombstone = (state: Persisted, collection: string, id: string): Persisted['tombstones'] => ({
    ...state.tombstones,
    [collection]: { ...state.tombstones[collection], [id]: new Date().toISOString() },
  });

  const removeInvoice = useCallback(async (invoiceId: string) => {
    update((state) => ({ ...state, invoices: state.invoices.filter((item) => item.id !== invoiceId), tombstones: tombstone(state, 'invoices', invoiceId) }));
  }, [update]);

  function upsertFactory<K extends 'parties' | 'products' | 'transporters'>(key: K) {
    return async (item: Omit<Persisted[K][number], 'id' | 'updatedAt'> & { id?: string }) => {
      const saved = { ...item, id: item.id ?? uid(`${key.slice(0, 2)}_`), updatedAt: new Date().toISOString() } as Persisted[K][number];
      update((state) => ({ ...state, [key]: [saved, ...(state[key] as Persisted[K][number][]).filter((existing) => existing.id !== saved.id)] }));
      return saved;
    };
  }
  function removeFactory(key: 'parties' | 'products' | 'transporters') {
    return async (id: string) => update((state) => ({ ...state, [key]: (state[key] as { id: string }[]).filter((item) => item.id !== id), tombstones: tombstone(state, key, id) }));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveParty = useCallback(upsertFactory('parties'), [update]) as StoreValue['saveParty'];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveProduct = useCallback(upsertFactory('products'), [update]) as StoreValue['saveProduct'];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveTransporter = useCallback(upsertFactory('transporters'), [update]) as StoreValue['saveTransporter'];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const removeParty = useCallback(removeFactory('parties'), [update]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const removeProduct = useCallback(removeFactory('products'), [update]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const removeTransporter = useCallback(removeFactory('transporters'), [update]);

  const setActiveGstin = useCallback(async (gstin: string) => update((state) => ({ ...state, activeGstin: gstin })), [update]);

  const upsertEwb = useCallback((ewb: EwbRecord) => {
    update((state) => {
      const ewbs = [ewb, ...state.ewbs.filter((item) => item.id !== ewb.id)].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
      return { ...state, ewbs, invoices: linkInvoices(state.invoices, ewbs) };
    });
  }, [update]);

  const setGstCache = useCallback((key: string, snapshots: GstSnapshot[]) => {
    update((state) => ({ ...state, gstCache: { ...state.gstCache, [key]: { snapshots, fetchedAt: new Date().toISOString() } } }));
  }, [update]);

  const clearLocalData = useCallback(async () => {
    if (scope) await AsyncStorage.removeItem(`${STORE_PREFIX}${scope}`);
    setData(EMPTY);
  }, [scope]);

  const exportData = useCallback(() => {
    const { tombstones: _t, gstCache: _g, ...rest } = dataRef.current;
    return JSON.stringify({ exportedAt: new Date().toISOString(), schema: 'ewb-vendor-export/1', ...rest }, null, 2);
  }, []);

  const value = useMemo<StoreValue>(() => ({
    business: data.business,
    invoices: data.invoices,
    parties: data.parties,
    products: data.products,
    transporters: data.transporters,
    activeGstin: data.activeGstin,
    ewbs: data.ewbs,
    ewbsFetchedAt: data.ewbsFetchedAt,
    gstCache: data.gstCache,
    lastSyncAt: data.lastSyncAt,
    isHydrated: !scope || hydratedScope === scope,
    previewOnly: previewMode,
    storageError,
    workspaceId,
    online,
    syncState,
    config,
    subscription,
    saveBusiness,
    setActiveGstin,
    saveInvoice,
    removeInvoice,
    saveParty,
    removeParty,
    saveProduct,
    removeProduct,
    saveTransporter,
    removeTransporter,
    upsertEwb,
    refreshEwbs,
    setGstCache,
    refreshServices,
    refreshSubscription,
    wallet,
    refreshWallet,
    setWalletBalance,
    syncNow,
    clearLocalData,
    exportData,
  }), [data, scope, hydratedScope, previewMode, storageError, workspaceId, online, syncState, config, subscription, wallet, saveBusiness, setActiveGstin, saveInvoice, removeInvoice, saveParty, removeParty, saveProduct, removeProduct, saveTransporter, removeTransporter, upsertEwb, refreshEwbs, setGstCache, refreshServices, refreshSubscription, refreshWallet, setWalletBalance, syncNow, clearLocalData, exportData]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider.');
  return value;
}

/** Invoices and bills scoped to the selected GST registration. */
export function useScopedRecords() {
  const store = useAppStore();
  return useMemo(() => {
    const gstin = store.activeGstin.toUpperCase();
    const invoices = gstin ? store.invoices.filter((invoice) => !invoice.sellerGstin || invoice.sellerGstin.toUpperCase() === gstin) : store.invoices;
    const ewbs = gstin ? store.ewbs.filter((ewb) => ewb.sellerGstin.toUpperCase() === gstin) : store.ewbs;
    return { invoices, ewbs };
  }, [store.activeGstin, store.invoices, store.ewbs]);
}
