import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Business, Invoice } from '@/lib/domain';
import { useAuth } from '@/state/auth';

type StoreValue = {
  business: Business | null;
  invoices: Invoice[];
  activeGstin: string;
  isHydrated: boolean;
  previewOnly: boolean;
  storageError: string;
  saveBusiness: (business: Business) => Promise<void>;
  setActiveGstin: (gstin: string) => Promise<void>;
  saveInvoice: (invoice: Invoice) => Promise<void>;
  removeInvoice: (invoiceId: string) => Promise<void>;
  clearLocalData: () => Promise<void>;
};

const StoreContext = createContext<StoreValue | null>(null);
const STORE_PREFIX = 'ewb-vendor-v1:';

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const { user, previewMode } = useAuth();
  const scope = previewMode ? 'preview' : user?.uid ?? null;
  const [business, setBusiness] = useState<Business | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activeGstin, setActiveGstinState] = useState('');
  const [storageError, setStorageError] = useState('');
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!scope) {
      setBusiness(null);
      setInvoices([]);
      setActiveGstinState('');
      setHydratedScope(null);
      setStorageError('');
      return;
    }
    setBusiness(null);
    setInvoices([]);
    setActiveGstinState('');
    setHydratedScope(null);
    setStorageError('');
    AsyncStorage.getItem(`${STORE_PREFIX}${scope}`)
      .then((stored) => {
        if (!active) return;
        if (stored) {
          const parsed = JSON.parse(stored) as {
            business?: Business | null;
            invoices?: Invoice[];
            activeGstin?: string;
          };
          setBusiness(parsed.business ?? null);
          setInvoices(parsed.invoices ?? []);
          setActiveGstinState(parsed.activeGstin ?? parsed.business?.defaultGstin ?? parsed.business?.gstin ?? '');
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

  useEffect(() => {
    if (!scope || hydratedScope !== scope) return;
    AsyncStorage.setItem(
      `${STORE_PREFIX}${scope}`,
      JSON.stringify({ business, invoices, activeGstin }),
    )
      .then(() => setStorageError(''))
      .catch(() => setStorageError('Could not save changes on this device. Check available storage.'));
  }, [scope, hydratedScope, business, invoices, activeGstin]);

  const saveBusiness = useCallback(async (next: Business) => {
    setBusiness(next);
    setActiveGstinState((current) => current || next.defaultGstin || next.gstin || '');
  }, []);

  const saveInvoice = useCallback(async (next: Invoice) => {
    setInvoices((current) => {
      const previous = current.find((item) => item.id === next.id);
      const actor = previewMode ? 'local-preview' : user?.uid ?? 'unknown';
      if (!previous) return [{ ...next, createdBy: next.createdBy ?? actor, updatedBy: actor }, ...current];
      const { updatedAt: _oldTime, createdBy: _oldCreator, updatedBy: _oldActor, revisionHistory: oldHistory, ...oldContent } = previous;
      const { updatedAt: _newTime, createdBy: _newCreator, updatedBy: _newActor, revisionHistory: _newHistory, ...newContent } = next;
      const changed = JSON.stringify(oldContent) !== JSON.stringify(newContent);
      const snapshot = { ...previous } as Invoice & { revisionHistory: Invoice['revisionHistory'] };
      delete (snapshot as Partial<Invoice>).revisionHistory;
      const revisionHistory = changed
        ? [...(oldHistory ?? []), snapshot].slice(-20)
        : next.revisionHistory ?? oldHistory ?? [];
      return current.map((item) => item.id === next.id
        ? { ...next, createdBy: previous.createdBy ?? actor, updatedBy: actor, revisionHistory }
        : item);
    });
  }, [previewMode, user?.uid]);

  const setActiveGstin = useCallback(async (gstin: string) => {
    setActiveGstinState(gstin);
  }, []);

  const removeInvoice = useCallback(async (invoiceId: string) => {
    setInvoices((current) => current.filter((item) => item.id !== invoiceId));
  }, []);

  const clearLocalData = useCallback(async () => {
    if (scope) await AsyncStorage.removeItem(`${STORE_PREFIX}${scope}`);
    setBusiness(null);
    setInvoices([]);
    setActiveGstinState('');
  }, [scope]);

  const value = useMemo<StoreValue>(
    () => ({
      business,
      invoices,
      activeGstin,
      isHydrated: !scope || hydratedScope === scope,
      previewOnly: previewMode || Boolean(user),
      storageError,
      saveBusiness,
      setActiveGstin,
      saveInvoice,
      removeInvoice,
      clearLocalData,
    }),
    [
      business,
      invoices,
      activeGstin,
      storageError,
      scope,
      hydratedScope,
      previewMode,
      user,
      saveBusiness,
      setActiveGstin,
      removeInvoice,
      saveInvoice,
      clearLocalData,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider.');
  return value;
}
