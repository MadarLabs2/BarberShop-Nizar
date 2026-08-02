import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  getAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  type AdminProduct,
} from '../services/admin.api';
import { invalidateCatalogProductsCache } from './useCatalogProducts';

const STALE_MS = 45_000;

type ProductsWarm = { products: AdminProduct[]; loadedAt: number };

let adminProductsWarm: ProductsWarm | null = null;
let adminProductsFetchInFlight: Promise<void> | null = null;

async function runAdminProductsFetch(token: string): Promise<void> {
  if (adminProductsFetchInFlight) {
    await adminProductsFetchInFlight;
    return;
  }
  const p = (async () => {
    try {
      const list = await getAdminProducts(token);
      adminProductsWarm = { products: list, loadedAt: Date.now() };
    } finally {
      adminProductsFetchInFlight = null;
    }
  })();
  adminProductsFetchInFlight = p;
  await p;
}

/** Background warm; dedupes with in-flight products fetch. */
export function prefetchAdminProducts(token: string | null): Promise<void> {
  if (!token) return Promise.resolve();
  return runAdminProductsFetch(token);
}

function peekAdminProductsWarm(): ProductsWarm | null {
  if (!adminProductsWarm || Date.now() - adminProductsWarm.loadedAt > STALE_MS) return null;
  return adminProductsWarm;
}

export type ProductFormState = {
  nameHe: string;
  nameAr: string;
  descriptionHe: string;
  descriptionAr: string;
  price: string;
  /** Empty = no sale (create) or clear sale (update when submitted empty). */
  salePrice: string;
  imageUrl: string;
  category: string;
  stockQuantity: string;
  isActive: boolean;
};

const emptyForm = (): ProductFormState => ({
  nameHe: '',
  nameAr: '',
  descriptionHe: '',
  descriptionAr: '',
  price: '',
  salePrice: '',
  imageUrl: '',
  category: '',
  stockQuantity: '0',
  isActive: true,
});

export function useAdminProducts(token: string | null) {
  const w0 = peekAdminProductsWarm();
  const [products, setProducts] = useState<AdminProduct[]>(() => w0?.products ?? []);
  const [loading, setLoading] = useState(() => w0 === null);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editItem, setEditItem] = useState<AdminProduct | null>(null);
  const [form, setForm] = useState<ProductFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const hasLoadedOnceRef = useRef(!!w0);
  const lastLoadAtRef = useRef(w0?.loadedAt ?? 0);

  const load = useCallback(async () => {
    if (!token) {
      hasLoadedOnceRef.current = false;
      adminProductsWarm = null;
      setProducts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      await runAdminProductsFetch(token);
      if (adminProductsWarm) setProducts(adminProductsWarm.products);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      const shouldRefetch =
        !hasLoadedOnceRef.current || Date.now() - lastLoadAtRef.current > STALE_MS;
      if (!shouldRefetch) return;
      if (!hasLoadedOnceRef.current) setLoading(true);
      load().finally(() => {
        lastLoadAtRef.current = adminProductsWarm?.loadedAt ?? Date.now();
        hasLoadedOnceRef.current = true;
      });
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const openAdd = useCallback(() => {
    setEditItem(null);
    setForm(emptyForm());
    setModalVisible(true);
  }, []);

  const openEdit = useCallback((p: AdminProduct) => {
    setEditItem(p);
    setForm({
      nameHe: p.nameHe,
      nameAr: p.nameAr,
      descriptionHe: p.descriptionHe ?? '',
      descriptionAr: p.descriptionAr ?? '',
      price: String(p.price),
      salePrice: p.salePrice != null ? String(p.salePrice) : '',
      imageUrl: p.imageUrl ?? '',
      category: p.category ?? '',
      stockQuantity: String(p.stockQuantity),
      isActive: p.isActive,
    });
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditItem(null);
  }, []);

  const handleSave = useCallback(
    async (parsed: {
      nameHe: string;
      nameAr: string;
      descriptionHe?: string;
      descriptionAr?: string;
      price: number;
      /** Create: undefined = no sale. Update: null clears sale. */
      salePrice?: number | null;
      /** Create: omit/undefined = no image. Update: include null to clear remote image. */
      imageUrl?: string | null;
      category?: string;
      stockQuantity: number;
      isActive: boolean;
    }) => {
      if (!token) return { error: 'לא מחובר' as const };
      if (saving) return { error: 'ממתין...' as const };
      setSaving(true);
      let snapshot: AdminProduct[] = [];
      try {
        if (editItem) {
          setProducts((list) => {
            snapshot = [...list];
            return list.map((x) =>
              x.id === editItem.id
                ? {
                    ...x,
                    name: parsed.nameHe,
                    nameHe: parsed.nameHe,
                    nameAr: parsed.nameAr,
                    description: parsed.descriptionHe ?? null,
                    descriptionHe: parsed.descriptionHe ?? null,
                    descriptionAr: parsed.descriptionAr ?? null,
                    price: parsed.price,
                    salePrice:
                      parsed.salePrice === undefined
                        ? x.salePrice
                        : parsed.salePrice != null && parsed.salePrice < parsed.price
                          ? parsed.salePrice
                          : null,
                    imageUrl:
                      parsed.imageUrl !== undefined ? parsed.imageUrl ?? null : x.imageUrl,
                    category: parsed.category ?? null,
                    stockQuantity: parsed.stockQuantity,
                    isActive: parsed.isActive,
                    updatedAt: new Date().toISOString(),
                  }
                : x,
            );
          });
          closeModal();
          const patch: Parameters<typeof updateProduct>[2] = {
            nameHe: parsed.nameHe,
            nameAr: parsed.nameAr,
            descriptionHe: parsed.descriptionHe,
            descriptionAr: parsed.descriptionAr,
            price: parsed.price,
            category: parsed.category,
            stockQuantity: parsed.stockQuantity,
            isActive: parsed.isActive,
          };
          if (parsed.salePrice !== undefined) patch.salePrice = parsed.salePrice;
          if (parsed.imageUrl !== undefined) patch.imageUrl = parsed.imageUrl;
          const updated = await updateProduct(token, editItem.id, patch);
          setProducts((list) => list.map((x) => (x.id === editItem.id ? updated : x)));
          adminProductsWarm = null;
          invalidateCatalogProductsCache();
        } else {
          const tempId = `temp-${Date.now()}`;
          const optimistic: AdminProduct = {
            id: tempId,
            name: parsed.nameHe,
            nameHe: parsed.nameHe,
            nameAr: parsed.nameAr,
            description: parsed.descriptionHe ?? null,
            descriptionHe: parsed.descriptionHe ?? null,
            descriptionAr: parsed.descriptionAr ?? null,
            price: parsed.price,
            salePrice:
              parsed.salePrice != null && parsed.salePrice < parsed.price ? parsed.salePrice : null,
            imageUrl: parsed.imageUrl ?? null,
            category: parsed.category ?? null,
            stockQuantity: parsed.stockQuantity,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setProducts((list) => {
            snapshot = [...list];
            return [...list, optimistic];
          });
          closeModal();
          const created = await createProduct(token, {
            nameHe: parsed.nameHe,
            nameAr: parsed.nameAr,
            descriptionHe: parsed.descriptionHe,
            descriptionAr: parsed.descriptionAr,
            price: parsed.price,
            ...(parsed.salePrice != null && parsed.salePrice < parsed.price ? { salePrice: parsed.salePrice } : {}),
            ...(parsed.imageUrl != null && parsed.imageUrl !== '' ? { imageUrl: parsed.imageUrl } : {}),
            category: parsed.category,
            stockQuantity: parsed.stockQuantity,
          });
          setProducts((list) => list.map((x) => (x.id === tempId ? created : x)));
          adminProductsWarm = null;
          invalidateCatalogProductsCache();
        }
        return {} as const;
      } catch (e) {
        setProducts(snapshot);
        const msg = e instanceof Error ? e.message : 'שגיאה';
        return { error: msg };
      } finally {
        setSaving(false);
      }
    },
    [token, saving, editItem, closeModal],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!token) return { error: 'לא מחובר' as const };
      let snapshot: AdminProduct[] = [];
      setProducts((list) => {
        snapshot = [...list];
        return list.filter((x) => x.id !== id);
      });
      setDeletingId(id);
      try {
        await deleteProduct(token, id);
        adminProductsWarm = null;
        invalidateCatalogProductsCache(id);
        return {} as const;
      } catch (e) {
        setProducts(snapshot);
        const msg = e instanceof Error ? e.message : 'שגיאה';
        return { error: msg };
      } finally {
        setDeletingId(null);
      }
    },
    [token],
  );

  return {
    products,
    loading,
    refreshing,
    modalVisible,
    editItem,
    form,
    setForm,
    saving,
    deletingId,
    openAdd,
    openEdit,
    closeModal,
    handleSave,
    handleDelete,
    onRefresh,
    setModalVisible,
  };
}
