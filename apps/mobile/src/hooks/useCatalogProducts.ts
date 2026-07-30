import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchCatalogProducts,
  fetchCatalogProductsForUser,
  type CatalogProduct,
} from '../services/bookings.api';
import { prefetchImageUrlOnce } from '../services/homeStoriesCache';

const STALE_MS = 60_000;
const PERSIST_MS = 24 * 60 * 60 * 1000;
const PRODUCT_CACHE_KEY = 'catalog_products_cache_v1';

type CacheEntry = { products: CatalogProduct[]; loadedAt: number; tokenKey: string };

let cache: CacheEntry | null = null;
let inFlight: Promise<CatalogProduct[]> | null = null;
let inFlightTokenKey: string | null = null;

const invalidationListeners = new Set<() => void>();

function notifyInvalidation() {
  invalidationListeners.forEach((fn) => fn());
}

function cacheTokenKey(token: string | null): string {
  return token ?? '';
}

function prefetchProductImages(list: CatalogProduct[]): void {
  list.forEach((product) => {
    const url = String(product.imageUrl || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    prefetchImageUrlOnce(url);
  });
}

async function persistCatalogProductsCache(): Promise<void> {
  try {
    if (!cache) {
      await AsyncStorage.removeItem(PRODUCT_CACHE_KEY);
      return;
    }
    await AsyncStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore cache persistence failures */
  }
}

export async function restoreCatalogProductsCache(token: string | null): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PRODUCT_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CacheEntry | null;
    if (
      !parsed ||
      !Array.isArray(parsed.products) ||
      typeof parsed.loadedAt !== 'number' ||
      typeof parsed.tokenKey !== 'string'
    ) {
      return;
    }
    if (Date.now() - parsed.loadedAt > PERSIST_MS) {
      await AsyncStorage.removeItem(PRODUCT_CACHE_KEY);
      return;
    }
    if (parsed.tokenKey !== cacheTokenKey(token)) return;
    cache = {
      products: parsed.products,
      loadedAt: Date.now(),
      tokenKey: parsed.tokenKey,
    };
    prefetchProductImages(parsed.products);
  } catch {
    /* ignore cache restore failures */
  }
}

export function clearCatalogProductsCache(): void {
  cache = null;
  inFlight = null;
  inFlightTokenKey = null;
  void persistCatalogProductsCache();
}

/**
 * Call after admin mutates catalog data. Refetches in background (deduped).
 * Pass `deletedProductId` after a permanent delete to drop that row from cache immediately (Home updates instantly).
 */
export function invalidateCatalogProductsCache(deletedProductId?: string) {
  if (deletedProductId && cache) {
    cache.products = cache.products.filter((p) => p.id !== deletedProductId);
    cache.loadedAt = Date.now();
  } else if (cache) {
    cache.loadedAt = 0;
  }
  void persistCatalogProductsCache();
  notifyInvalidation();
}

function isCacheFresh(now: number, token: string | null): boolean {
  const tk = cacheTokenKey(token);
  return (
    cache !== null &&
    cache.loadedAt > 0 &&
    now - cache.loadedAt < STALE_MS &&
    cache.tokenKey === tk
  );
}

function fetchProductsDeduped(token: string | null): Promise<CatalogProduct[]> {
  const tk = cacheTokenKey(token);
  if (inFlight && inFlightTokenKey === tk) return inFlight;
  inFlightTokenKey = tk;
  inFlight = (token ? fetchCatalogProductsForUser(token) : fetchCatalogProducts())
    .then((list) => {
      cache = { products: list, loadedAt: Date.now(), tokenKey: tk };
      prefetchProductImages(list);
      void persistCatalogProductsCache();
      return list;
    })
    .finally(() => {
      inFlight = null;
      inFlightTokenKey = null;
    });
  return inFlight;
}

/** Used by customer tab prefetch to align Home catalog cache with a completed fetch. */
export function seedCatalogProductsCache(products: CatalogProduct[], token: string | null): void {
  cache = { products, loadedAt: Date.now(), tokenKey: cacheTokenKey(token) };
  prefetchProductImages(products);
  void persistCatalogProductsCache();
  notifyInvalidation();
}

/**
 * @param token — When auth is restored and token is set, loads shop + barber listings via `GET /catalog/products/my`.
 * Guests use `GET /catalog/products` (admin shop catalog only).
 */
export function useCatalogProducts(token: string | null, isRestored: boolean) {
  const [products, setProducts] = useState<CatalogProduct[]>(() => cache?.products ?? []);
  /** True only until the first successful catalog fetch in this session (spinner in empty state). */
  const [loading, setLoading] = useState(() => cache === null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const finishWithList = useCallback((list: CatalogProduct[]) => {
    if (!mountedRef.current) return;
    setProducts(list);
    setLoading(false);
    setRefreshing(false);
  }, []);

  /** Admin mutation: apply cache immediately, then silent background sync (deduped). */
  useEffect(() => {
    const onInvalidate = () => {
      const tk = cacheTokenKey(tokenRef.current);
      if (mountedRef.current && cache && cache.tokenKey === tk) {
        setProducts([...cache.products]);
        setLoading(false);
      }
      fetchProductsDeduped(tokenRef.current)
        .then((list) => finishWithList(list))
        .catch(() => {
          if (mountedRef.current && cache?.products.length && cache.tokenKey === tk) {
            setProducts(cache.products);
            setLoading(false);
          }
        });
    };
    invalidationListeners.add(onInvalidate);
    return () => {
      invalidationListeners.delete(onInvalidate);
    };
  }, [finishWithList]);

  useFocusEffect(
    useCallback(() => {
      if (!isRestored) return;

      const effectiveToken = token;
      const now = Date.now();
      if (isCacheFresh(now, effectiveToken)) {
        if (cache && cache.tokenKey === cacheTokenKey(effectiveToken)) {
          setProducts(cache.products);
          setLoading(false);
        }
        return;
      }

      const hadCachedList = cache !== null && cache.tokenKey === cacheTokenKey(effectiveToken);
      if (!hadCachedList) setLoading(true);

      fetchProductsDeduped(effectiveToken)
        .then((list) => finishWithList(list))
        .catch(() => {
          if (!mountedRef.current) return;
          setLoading(false);
          setRefreshing(false);
          const tk = cacheTokenKey(effectiveToken);
          if (cache?.products.length && cache.tokenKey === tk) setProducts(cache.products);
        });
    }, [finishWithList, isRestored, token]),
  );

  /** Explicit pull-to-refresh only (shows `refreshing`). */
  const onRefresh = useCallback(() => {
    if (!isRestored) return;
    setRefreshing(true);
    fetchProductsDeduped(token)
      .then((list) => finishWithList(list))
      .catch(() => {
        if (mountedRef.current) {
          setRefreshing(false);
          const tk = cacheTokenKey(token);
          if (cache?.products.length && cache.tokenKey === tk) setProducts(cache.products);
        }
      });
  }, [finishWithList, isRestored, token]);

  return { products, loading, refreshing, onRefresh };
}
