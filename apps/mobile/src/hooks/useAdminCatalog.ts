import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { AdminCatalog } from '../services/admin.api';
import {
  getAdminCatalog,
  getBranchStaff,
  getStaffServices,
  addBranchStaff,
  addStaffService,
  updateStaffService,
  removeBranchStaff,
  removeStaffService,
  getAllStaffWorkingDays,
  addStaffWorkingDay,
  updateStaffWorkingDay,
  removeStaffWorkingDayByDay,
  createBranch,
  updateBranch,
  deleteBranch,
  createService,
  updateService,
  deleteService,
  createStaff,
  updateStaff,
  uploadStaffAvatar,
  deleteStaff,
  type Branch,
  type Service,
  type Staff,
  type BranchStaffLink,
  type StaffWorkingDaysMap,
} from '../services/admin.api';
import { validateWorkingTimeRange } from '../utils/validators';
import type { CatalogStaffMember } from '../services/bookings.api';
import { upsertStaffInTeamCache, removeStaffFromTeamCache } from '../services/customerPrefetchCache';
import { prefetchImageUrlOnce } from '../services/homeStoriesCache';

function staffToCatalogMember(s: Staff): CatalogStaffMember {
  return { id: s.id, name: s.name, phone: s.phone, avatarUrl: s.avatarUrl };
}

function isTempStaffId(id: string): boolean {
  return id.startsWith('temp-staff-');
}

/** Shared stale window for catalog warm cache, focus skip, and dashboard prefetch. */
export const ADMIN_CATALOG_STALE_MS = 45_000;
const ADMIN_CATALOG_PERSIST_MS = 24 * 60 * 60 * 1000;
const ADMIN_CATALOG_WARM_KEY = 'admin_catalog_warm_v1';

export type AdminCatalogWarmSnapshot = {
  branches: Branch[];
  services: Service[];
  staff: Staff[];
  branchStaffMap: Record<string, { linkId: string; staffId: string; staffName: string }[]>;
  branchStaffLinks: BranchStaffLink[];
  staffServiceMap: Record<string, { linkId: string; staffId: string; staffName: string; price: number; duration: number }[]>;
  staffServiceLinks: { id: string; staffId: string; serviceId: string; price: number; duration: number }[];
  staffWorkingDays: StaffWorkingDaysMap;
  loadedAt: number;
};

let adminCatalogWarm: AdminCatalogWarmSnapshot | null = null;
let adminCatalogFetchInFlight: Promise<void> | null = null;

/** Drop warm snapshot so the next peek/prefetch refetches after catalog mutations. */
function invalidateAdminCatalogWarm() {
  adminCatalogWarm = null;
  void persistAdminCatalogWarmSnapshot();
}

function prefetchAdminCatalogAvatarImages(staffList: Staff[]): void {
  staffList.forEach((member) => {
    const url = String(member.avatarUrl || '').trim();
    if (!url) return;
    prefetchImageUrlOnce(url);
  });
}

async function persistAdminCatalogWarmSnapshot(): Promise<void> {
  try {
    if (!adminCatalogWarm) {
      await AsyncStorage.removeItem(ADMIN_CATALOG_WARM_KEY);
      return;
    }
    await AsyncStorage.setItem(ADMIN_CATALOG_WARM_KEY, JSON.stringify(adminCatalogWarm));
  } catch {
    /* ignore cache persistence failures */
  }
}

export async function restoreAdminCatalogWarm(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ADMIN_CATALOG_WARM_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as AdminCatalogWarmSnapshot | null;
    if (!parsed || typeof parsed.loadedAt !== 'number') return;
    if (Date.now() - parsed.loadedAt > ADMIN_CATALOG_PERSIST_MS) {
      await AsyncStorage.removeItem(ADMIN_CATALOG_WARM_KEY);
      return;
    }
    adminCatalogWarm = {
      ...parsed,
      loadedAt: Date.now(),
    };
    prefetchAdminCatalogAvatarImages(parsed.staff ?? []);
  } catch {
    /* ignore cache restore failures */
  }
}

export function clearAdminCatalogWarm(): void {
  adminCatalogWarm = null;
  adminCatalogFetchInFlight = null;
  void persistAdminCatalogWarmSnapshot();
}

function buildAdminCatalogSnapshot(
  data: AdminCatalog,
  links: BranchStaffLink[],
  staffSvcLinks: { id: string; staffId: string; serviceId: string; price: number; duration: number }[],
  workingDays: StaffWorkingDaysMap
): AdminCatalogWarmSnapshot {
  const activeStaffById = new Map(
    data.staff.filter((s) => s.isActive).map((s) => [s.id, s] as const)
  );
  const branchMap: Record<string, { linkId: string; staffId: string; staffName: string }[]> = {};
  data.branches.forEach((b) => {
    const branchLinks = links.filter((l) => l.branchId === b.id && activeStaffById.has(l.staffId));
    branchMap[b.id] = branchLinks.map((l) => ({
      linkId: l.id,
      staffId: l.staffId,
      staffName: activeStaffById.get(l.staffId)?.name ?? '?',
    }));
  });
  const serviceMap: Record<string, { linkId: string; staffId: string; staffName: string; price: number; duration: number }[]> = {};
  data.services.forEach((svc) => {
    const svcLinks = staffSvcLinks.filter((l) => l.serviceId === svc.id && activeStaffById.has(l.staffId));
    serviceMap[svc.id] = svcLinks.map((l) => ({
      linkId: l.id,
      staffId: l.staffId,
      staffName: activeStaffById.get(l.staffId)?.name ?? '?',
      price: l.price,
      duration: l.duration,
    }));
  });
  return {
    branches: data.branches,
    services: data.services,
    staff: data.staff,
    branchStaffMap: branchMap,
    branchStaffLinks: links,
    staffServiceMap: serviceMap,
    staffServiceLinks: staffSvcLinks,
    staffWorkingDays: workingDays,
    loadedAt: Date.now(),
  };
}

async function runAdminCatalogFetch(token: string): Promise<void> {
  if (adminCatalogFetchInFlight) {
    await adminCatalogFetchInFlight;
    return;
  }
  const p = (async () => {
    try {
      const [data, links, staffSvcLinks, workingDays] = await Promise.all([
        getAdminCatalog(token),
        getBranchStaff(token),
        getStaffServices(token),
        getAllStaffWorkingDays(token),
      ]);
      adminCatalogWarm = buildAdminCatalogSnapshot(data, links, staffSvcLinks, workingDays);
      prefetchAdminCatalogAvatarImages(adminCatalogWarm.staff);
      void persistAdminCatalogWarmSnapshot();
    } finally {
      adminCatalogFetchInFlight = null;
    }
  })();
  adminCatalogFetchInFlight = p;
  await p;
}

/** Background warm for dashboard / Admin entry; dedupes with in-flight catalog fetch. */
export function prefetchAdminCatalog(token: string | null): Promise<void> {
  if (!token) return Promise.resolve();
  return runAdminCatalogFetch(token);
}

export function peekAdminCatalogWarm(): AdminCatalogWarmSnapshot | null {
  if (!adminCatalogWarm || Date.now() - adminCatalogWarm.loadedAt > ADMIN_CATALOG_STALE_MS) return null;
  return adminCatalogWarm;
}

/** For AdminStaffScheduleScreen: reuse catalog staff names without waiting for fetchStaff. */
export function getWarmStaffChipsForSchedule(): { id: string; name: string }[] | null {
  const w = peekAdminCatalogWarm();
  const active = (w?.staff ?? []).filter((s) => s.isActive);
  if (active.length === 0) return null;
  return active.map((s) => ({ id: s.id, name: s.name }));
}

export type AdminTab = 'staff' | 'services' | 'branches' | 'workdays';

function applyWarmToSetter(w: AdminCatalogWarmSnapshot) {
  return {
    branches: w.branches,
    services: w.services,
    staff: w.staff,
    branchStaffMap: w.branchStaffMap,
    branchStaffLinks: w.branchStaffLinks,
    staffServiceMap: w.staffServiceMap,
    staffServiceLinks: w.staffServiceLinks,
    staffWorkingDays: w.staffWorkingDays,
  };
}

export function useAdminCatalog(token: string | null, routeParams?: { tab?: AdminTab }) {
  const initialTab = routeParams?.tab ?? 'staff';
  const w0 = peekAdminCatalogWarm();
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [branches, setBranches] = useState<Branch[]>(() => w0?.branches ?? []);
  const [services, setServices] = useState<Service[]>(() => w0?.services ?? []);
  const [staff, setStaff] = useState<Staff[]>(() => w0?.staff ?? []);
  const [branchStaffMap, setBranchStaffMap] = useState<
    Record<string, { linkId: string; staffId: string; staffName: string }[]>
  >(() => w0?.branchStaffMap ?? {});
  const [branchStaffLinks, setBranchStaffLinks] = useState<BranchStaffLink[]>(() => w0?.branchStaffLinks ?? []);
  const [staffServiceMap, setStaffServiceMap] = useState<
    Record<string, { linkId: string; staffId: string; staffName: string; price: number; duration: number }[]>
  >(() => w0?.staffServiceMap ?? {});
  const [staffServiceLinks, setStaffServiceLinks] = useState<
    { id: string; staffId: string; serviceId: string; price: number; duration: number }[]
  >(() => w0?.staffServiceLinks ?? []);
  const [staffWorkingDays, setStaffWorkingDays] = useState<StaffWorkingDaysMap>(() => w0?.staffWorkingDays ?? {});
  const staffWorkingDaysRef = useRef<StaffWorkingDaysMap>({});
  const togglingRef = useRef<string | null>(null);
  const [togglingWorkingDay, setTogglingWorkingDay] = useState<string | null>(null);
  const [updatingWorkingDayTime, setUpdatingWorkingDayTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => w0 === null);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editItem, setEditItem] = useState<Branch | Service | Staff | null>(null);
  const [form, setForm] = useState({ name: '', address: '', wazeLink: '', price: '', duration: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [addStaffBranch, setAddStaffBranch] = useState<string | null>(null);
  const [addStaffServiceId, setAddStaffServiceId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [addingBranchStaff, setAddingBranchStaff] = useState<{ branchId: string; staffId: string } | null>(null);
  const [addingStaffService, setAddingStaffService] = useState<{ serviceId: string; staffId: string } | null>(null);
  const [removingLinkId, setRemovingLinkId] = useState<string | null>(null);
  const [removingStaffServiceId, setRemovingStaffServiceId] = useState<string | null>(null);
  const [updatingStaffServiceId, setUpdatingStaffServiceId] = useState<string | null>(null);
  /** Optimistic `temp-staff-*` rows: if user deletes before `createStaff` finishes, we cancel server-side row after create. */
  const pendingStaffCreatesRef = useRef(new Map<string, { cancelled: boolean }>());

  const hasLoadedOnceRef = useRef(!!w0);
  const lastLoadAtRef = useRef<number>(w0?.loadedAt ?? 0);

  const load = useCallback(async () => {
    if (!token) {
      hasLoadedOnceRef.current = false;
      adminCatalogWarm = null;
      return;
    }
    try {
      await runAdminCatalogFetch(token);
      const w = adminCatalogWarm;
      if (!w) return;
      const a = applyWarmToSetter(w);
      setBranches(a.branches);
      setServices(a.services);
      setStaff(a.staff);
      setBranchStaffLinks(a.branchStaffLinks);
      setStaffServiceLinks(a.staffServiceLinks);
      setStaffWorkingDays(a.staffWorkingDays);
      setBranchStaffMap(a.branchStaffMap);
      setStaffServiceMap(a.staffServiceMap);
    } catch {
      setBranches([]);
      setServices([]);
      setStaff([]);
      setBranchStaffLinks([]);
      setBranchStaffMap({});
      setStaffServiceLinks([]);
      setStaffServiceMap({});
      setStaffWorkingDays({});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    staffWorkingDaysRef.current = staffWorkingDays;
  }, [staffWorkingDays]);

  useFocusEffect(
    useCallback(() => {
      const tab = routeParams?.tab;
      if (tab) setActiveTab(tab);
      const shouldRefetch =
        !hasLoadedOnceRef.current || Date.now() - lastLoadAtRef.current > ADMIN_CATALOG_STALE_MS;
      if (!shouldRefetch) return;
      if (!hasLoadedOnceRef.current) setLoading(true);
      else setRefreshing(true);
      load().finally(() => {
        lastLoadAtRef.current = adminCatalogWarm?.loadedAt ?? Date.now();
        hasLoadedOnceRef.current = true;
      });
    }, [load, routeParams?.tab])
  );

  const onRefresh = useCallback(() => {
    if (togglingWorkingDay) return;
    setRefreshing(true);
    load();
  }, [load, togglingWorkingDay]);

  const openAdd = useCallback(() => {
    setEditItem(null);
    setForm({ name: '', address: '', wazeLink: '', price: '', duration: '', phone: '' });
    setModalVisible(true);
  }, []);

  const openEdit = useCallback((item: Branch | Service | Staff) => {
    setEditItem(item);
    if ('address' in item) {
      const b = item as Branch;
      setForm({ name: b.name, address: b.address ?? '', wazeLink: b.wazeLink ?? '', price: '', duration: '', phone: '' });
    } else if ('price' in item) {
      const s = item as Service;
      setForm({ name: s.name, address: '', wazeLink: '', price: String(s.price), duration: String(s.duration), phone: '' });
    } else {
      const st = item as Staff;
      setForm({ name: st.name, address: '', wazeLink: '', price: '', duration: '', phone: st.phone ?? '' });
    }
    setModalVisible(true);
  }, []);

  const handleSave = useCallback(
    async (avatarOpts?: {
      staffAvatarUri?: string;
      staffAvatarMime?: string | null;
      staffAvatarRemove?: boolean;
    }) => {
      if (!token) return { error: 'לא מחובר' };
      if (saving) return { error: 'ממתין...' };
      setSaving(true);
      const prevBranches = [...branches];
      const prevServices = [...services];
      const prevStaff = [...staff];
      let tempId: string | null = null;
      let isCreate = false;
      /** Set after createStaff so we can revert customer cache if upload fails. */
      let staffCreatedForRevert: Staff | null = null;
      try {
        if (activeTab === 'branches') {
          const dto = {
            name: form.name.trim(),
            address: form.address.trim() || undefined,
            wazeLink: form.wazeLink.trim() || undefined,
          };
          if (editItem) {
            setBranches((list) =>
              list.map((b) =>
                b.id === editItem.id
                  ? { ...b, name: dto.name, address: dto.address ?? b.address ?? null, wazeLink: dto.wazeLink ?? b.wazeLink ?? null }
                  : b
              )
            );
            setModalVisible(false);
            setEditItem(null);
            const updated = await updateBranch(token, editItem.id, dto);
            setBranches((list) => list.map((b) => (b.id === editItem.id ? { ...b, ...updated } : b)));
          } else {
            isCreate = true;
            tempId = `temp-branch-${Date.now()}`;
            const temp: Branch = {
              id: tempId,
              name: dto.name,
              address: dto.address ?? null,
              wazeLink: dto.wazeLink ?? null,
              isActive: true,
            };
            setBranches((list) => [...list, temp]);
            setModalVisible(false);
            setEditItem(null);
            const created = await createBranch(token, dto);
            setBranches((list) => list.map((b) => (b.id === tempId ? created : b)));
          }
        } else if (activeTab === 'services') {
          const price = parseInt(form.price, 10);
          const duration = parseInt(form.duration, 10);
          if (isNaN(price) || price < 0) return { error: 'מחיר לא תקין' };
          if (isNaN(duration) || duration < 5) return { error: 'משך מינימלי 5 דקות' };
          const dto = { name: form.name.trim(), price, duration };
          if (editItem) {
            setServices((list) => list.map((s) => (s.id === editItem.id ? { ...s, ...dto } : s)));
            setModalVisible(false);
            setEditItem(null);
            const updated = await updateService(token, editItem.id, dto);
            setServices((list) => list.map((s) => (s.id === editItem.id ? { ...s, ...updated } : s)));
          } else {
            isCreate = true;
            tempId = `temp-service-${Date.now()}`;
            const temp: Service = { id: tempId, name: dto.name, price: dto.price, duration: dto.duration, isActive: true };
            setServices((list) => [...list, temp]);
            setModalVisible(false);
            setEditItem(null);
            const created = await createService(token, dto);
            setServices((list) => list.map((s) => (s.id === tempId ? created : s)));
          }
        } else {
          const dto = { name: form.name.trim(), phone: form.phone.trim() || undefined };
          if (editItem) {
            const prevSt = editItem as Staff;
            /** Instant Team + Booking: local file URI or cleared avatar before network (RN Image supports file://). */
            if (avatarOpts?.staffAvatarUri) {
              upsertStaffInTeamCache({
                id: prevSt.id,
                name: dto.name!,
                phone: (dto.phone ?? prevSt.phone) ?? null,
                avatarUrl: avatarOpts.staffAvatarUri,
              });
            } else if (avatarOpts?.staffAvatarRemove) {
              upsertStaffInTeamCache({
                id: prevSt.id,
                name: dto.name!,
                phone: (dto.phone ?? prevSt.phone) ?? null,
                avatarUrl: null,
              });
            } else {
              upsertStaffInTeamCache({
                id: prevSt.id,
                name: dto.name!,
                phone: (dto.phone ?? prevSt.phone) ?? null,
                avatarUrl: prevSt.avatarUrl,
              });
            }
            /** Admin אנשי צוות list: same optimistic avatar/name as Team (local file:// before upload). */
            setStaff((list) =>
              list.map((s) => {
                if (s.id !== editItem.id) return s;
                const base = { ...s, name: dto.name!, phone: dto.phone ?? s.phone ?? null };
                if (avatarOpts?.staffAvatarUri) return { ...base, avatarUrl: avatarOpts.staffAvatarUri };
                if (avatarOpts?.staffAvatarRemove) return { ...base, avatarUrl: null };
                return base;
              })
            );
            setModalVisible(false);
            setEditItem(null);
            let resultStaff: Staff;
            if (avatarOpts?.staffAvatarUri) {
              await updateStaff(token, editItem.id, dto);
              resultStaff = await uploadStaffAvatar(
                token,
                editItem.id,
                avatarOpts.staffAvatarUri,
                avatarOpts.staffAvatarMime
              );
              setStaff((list) => list.map((s) => (s.id === editItem.id ? { ...s, ...resultStaff } : s)));
            } else if (avatarOpts?.staffAvatarRemove) {
              resultStaff = await updateStaff(token, editItem.id, { ...dto, avatarUrl: null });
              setStaff((list) => list.map((s) => (s.id === editItem.id ? { ...s, ...resultStaff } : s)));
            } else {
              resultStaff = await updateStaff(token, editItem.id, dto);
              setStaff((list) => list.map((s) => (s.id === editItem.id ? { ...s, ...resultStaff } : s)));
            }
            upsertStaffInTeamCache(staffToCatalogMember(resultStaff));
          } else {
            isCreate = true;
            tempId = `temp-staff-${Date.now()}`;
            const temp: Staff = {
              id: tempId,
              name: dto.name!,
              phone: dto.phone ?? null,
              avatarUrl: avatarOpts?.staffAvatarUri ?? null,
              isActive: true,
              profileId: null,
              canBlockOwnTime: false,
              canSetOwnWorkingHours: false,
            };
            setStaff((list) => [...list, temp]);
            setModalVisible(false);
            setEditItem(null);
            const pendingEntry = { cancelled: false };
            pendingStaffCreatesRef.current.set(tempId, pendingEntry);
            const created = await createStaff(token, { name: dto.name!, phone: dto.phone });
            staffCreatedForRevert = created;
            if (pendingEntry.cancelled) {
              pendingStaffCreatesRef.current.delete(tempId);
              try {
                await deleteStaff(token, created.id);
                removeStaffFromTeamCache(created.id);
              } catch {
                /* ignore */
              }
              invalidateAdminCatalogWarm();
              return { success: true };
            }
            let finalStaff = created;
            if (avatarOpts?.staffAvatarUri) {
              upsertStaffInTeamCache({
                id: created.id,
                name: created.name,
                phone: created.phone,
                avatarUrl: avatarOpts.staffAvatarUri,
              });
              finalStaff = await uploadStaffAvatar(
                token,
                created.id,
                avatarOpts.staffAvatarUri,
                avatarOpts.staffAvatarMime
              );
            }
            if (pendingEntry.cancelled) {
              pendingStaffCreatesRef.current.delete(tempId);
              try {
                await deleteStaff(token, finalStaff.id);
                removeStaffFromTeamCache(finalStaff.id);
              } catch {
                /* ignore */
              }
              invalidateAdminCatalogWarm();
              return { success: true };
            }
            pendingStaffCreatesRef.current.delete(tempId);
            setStaff((list) => list.map((s) => (s.id === tempId ? finalStaff : s)));
            upsertStaffInTeamCache(staffToCatalogMember(finalStaff));
          }
        }
        invalidateAdminCatalogWarm();
        return { success: true };
      } catch (e) {
        if (activeTab === 'staff' && editItem && 'avatarUrl' in editItem) {
          const revert = prevStaff.find((s) => s.id === editItem.id);
          if (revert) upsertStaffInTeamCache(staffToCatalogMember(revert));
        } else if (staffCreatedForRevert && avatarOpts?.staffAvatarUri) {
          upsertStaffInTeamCache(staffToCatalogMember(staffCreatedForRevert));
        }
        if (isCreate && tempId) {
          pendingStaffCreatesRef.current.delete(tempId);
          setBranches((list) => list.filter((b) => b.id !== tempId));
          setServices((list) => list.filter((s) => s.id !== tempId));
          setStaff((list) => list.filter((s) => s.id !== tempId));
        } else {
          setBranches(prevBranches);
          setServices(prevServices);
          setStaff(prevStaff);
        }
        const raw = e instanceof Error ? e.message : 'לא הצלחנו לשמור';
        const friendly =
          raw === 'PHONE_ALREADY_CUSTOMER_OR_ADMIN'
            ? 'מספר הטלפון כבר רשום כלקוח או מנהל.'
            : raw === 'PHONE_ALREADY_STAFF'
              ? 'מספר הטלפון כבר שייך לאיש צוות אחר.'
              : raw;
        return { error: friendly };
      } finally {
        setSaving(false);
      }
    },
    [token, activeTab, editItem, form, saving, branches, services, staff]
  );

  const handleAddBranchStaff = useCallback(
    async (branchId: string, staffId: string) => {
      if (!token) return { error: 'לא מחובר' };
      if (addingBranchStaff) return { error: 'ממתין...' };
      setAddingBranchStaff({ branchId, staffId });
      const staffName = staff.find((s) => s.id === staffId)?.name ?? '?';
      const tempLinkId = `temp-link-${Date.now()}`;
      const prevMap = { ...branchStaffMap };
      const prevLinks = [...branchStaffLinks];
      try {
        setBranchStaffMap((m) => ({
          ...m,
          [branchId]: [...(m[branchId] ?? []), { linkId: tempLinkId, staffId, staffName }],
        }));
        setBranchStaffLinks((list) => [...list, { id: tempLinkId, branchId, staffId }]);
        setAddStaffBranch(null);
        const { id } = await addBranchStaff(token, branchId, staffId);
        setBranchStaffMap((m) => ({
          ...m,
          [branchId]: (m[branchId] ?? []).map((x) => (x.linkId === tempLinkId ? { ...x, linkId: id } : x)),
        }));
        setBranchStaffLinks((list) => list.map((l) => (l.id === tempLinkId ? { ...l, id } : l)));
        invalidateAdminCatalogWarm();
        return { success: true };
      } catch (e) {
        setBranchStaffMap(prevMap);
        setBranchStaffLinks(prevLinks);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו להוסיף' };
      } finally {
        setAddingBranchStaff(null);
      }
    },
    [token, staff, branchStaffMap, branchStaffLinks, addingBranchStaff]
  );

  const handleRemoveBranchStaff = useCallback(
    async (linkId: string) => {
      if (!token) return { error: 'לא מחובר' };
      if (removingLinkId) return { error: 'ממתין...' };
      setRemovingLinkId(linkId);
      const link = branchStaffLinks.find((l) => l.id === linkId);
      const prevMap = { ...branchStaffMap };
      const prevLinks = [...branchStaffLinks];
      try {
        if (link) {
          setBranchStaffMap((m) => ({
            ...m,
            [link.branchId]: (m[link.branchId] ?? []).filter((x) => x.linkId !== linkId),
          }));
          setBranchStaffLinks((list) => list.filter((l) => l.id !== linkId));
        }
        await removeBranchStaff(token, linkId);
        invalidateAdminCatalogWarm();
        return { success: true };
      } catch (e) {
        setBranchStaffMap(prevMap);
        setBranchStaffLinks(prevLinks);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו להסיר' };
      } finally {
        setRemovingLinkId(null);
      }
    },
    [token, branchStaffLinks, branchStaffMap, removingLinkId]
  );

  const handleDelete = useCallback(
    async (item: Branch | Service | Staff) => {
      if (!token) return { error: 'לא מחובר' };
      if (deletingItemId) return { error: 'ממתין...' };
      setDeletingItemId(item.id);
      const prevBranches = [...branches];
      const prevServices = [...services];
      const prevStaff = [...staff];
      const prevMap = { ...branchStaffMap };
      const prevLinks = [...branchStaffLinks];
      const prevStaffSvcMap = { ...staffServiceMap };
      const prevStaffSvcLinks = [...staffServiceLinks];
      const isBranch = 'address' in item;
      const isService = 'price' in item;
      const deletedStaffSnapshot = !isBranch && !isService ? (item as Staff) : null;
      const staffItem = !isBranch && !isService ? (item as Staff) : null;
      if (staffItem && isTempStaffId(staffItem.id)) {
        const pending = pendingStaffCreatesRef.current.get(staffItem.id);
        if (pending) pending.cancelled = true;
      }
      try {
        if (isBranch) {
          setBranches((list) => list.filter((b) => b.id !== item.id));
          setBranchStaffMap((m) => {
            const next = { ...m };
            delete next[item.id];
            return next;
          });
          setBranchStaffLinks((list) => list.filter((l) => l.branchId !== item.id));
        } else if (isService) {
          setServices((list) => list.filter((s) => s.id !== item.id));
          setStaffServiceMap((m) => {
            const next = { ...m };
            delete next[item.id];
            return next;
          });
          setStaffServiceLinks((list) => list.filter((l) => l.serviceId !== item.id));
        } else {
          setStaff((list) => list.filter((s) => s.id !== item.id));
          setBranchStaffMap((m) => {
            const next: Record<string, { linkId: string; staffId: string; staffName: string }[]> = {};
            for (const [bid, arr] of Object.entries(m)) {
              const filtered = arr.filter((x) => x.staffId !== item.id);
              if (filtered.length > 0) next[bid] = filtered;
            }
            return next;
          });
          setBranchStaffLinks((list) => list.filter((l) => l.staffId !== item.id));
          setStaffServiceMap((m) => {
            const next: Record<string, { linkId: string; staffId: string; staffName: string; price: number; duration: number }[]> = {};
            for (const [sid, arr] of Object.entries(m)) {
              const filtered = arr.filter((x) => x.staffId !== item.id);
              if (filtered.length > 0) next[sid] = filtered;
            }
            return next;
          });
          setStaffServiceLinks((list) => list.filter((l) => l.staffId !== item.id));
          if (!isTempStaffId(item.id)) {
            removeStaffFromTeamCache(item.id);
          }
        }
        if (isBranch) await deleteBranch(token, item.id);
        else if (isService) await deleteService(token, item.id);
        else if (!isTempStaffId((item as Staff).id)) await deleteStaff(token, item.id);
        invalidateAdminCatalogWarm();
        return { success: true };
      } catch (e) {
        setBranches(prevBranches);
        setServices(prevServices);
        setStaff(prevStaff);
        setBranchStaffMap(prevMap);
        setBranchStaffLinks(prevLinks);
        setStaffServiceMap(prevStaffSvcMap);
        setStaffServiceLinks(prevStaffSvcLinks);
        if (deletedStaffSnapshot && !isTempStaffId(deletedStaffSnapshot.id)) {
          upsertStaffInTeamCache(staffToCatalogMember(deletedStaffSnapshot));
        }
        return { error: e instanceof Error ? e.message : 'לא הצלחנו למחוק' };
      } finally {
        setDeletingItemId(null);
      }
    },
    [token, deletingItemId, branches, services, staff, branchStaffMap, branchStaffLinks, staffServiceMap, staffServiceLinks]
  );

  const [togglingBlockPermissionId, setTogglingBlockPermissionId] = useState<string | null>(null);

  /** Admin grants/revokes a staff member's ability to manage their own blocked time. */
  const toggleStaffCanBlockOwnTime = useCallback(
    async (staffId: string, next: boolean): Promise<{ error?: string }> => {
      if (!token) return { error: 'לא מחובר' };
      const prev = [...staff];
      setTogglingBlockPermissionId(staffId);
      setStaff((list) => list.map((s) => (s.id === staffId ? { ...s, canBlockOwnTime: next } : s)));
      try {
        await updateStaff(token, staffId, { canBlockOwnTime: next });
        invalidateAdminCatalogWarm();
        return {};
      } catch (e) {
        setStaff(prev);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו לעדכן הרשאה' };
      } finally {
        setTogglingBlockPermissionId(null);
      }
    },
    [token, staff],
  );

  const [togglingWorkingHoursPermissionId, setTogglingWorkingHoursPermissionId] = useState<string | null>(null);

  /** Admin grants/revokes a staff member's ability to manage their own working days/hours. */
  const toggleStaffCanSetOwnWorkingHours = useCallback(
    async (staffId: string, next: boolean): Promise<{ error?: string }> => {
      if (!token) return { error: 'לא מחובר' };
      const prev = [...staff];
      setTogglingWorkingHoursPermissionId(staffId);
      setStaff((list) => list.map((s) => (s.id === staffId ? { ...s, canSetOwnWorkingHours: next } : s)));
      try {
        await updateStaff(token, staffId, { canSetOwnWorkingHours: next });
        invalidateAdminCatalogWarm();
        return {};
      } catch (e) {
        setStaff(prev);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו לעדכן הרשאה' };
      } finally {
        setTogglingWorkingHoursPermissionId(null);
      }
    },
    [token, staff],
  );

  const handleAddStaffService = useCallback(
    async (serviceId: string, staffId: string) => {
      if (!token) return { error: 'לא מחובר' };
      if (addingStaffService) return { error: 'ממתין...' };
      const svc = services.find((s) => s.id === serviceId);
      const price = svc?.price ?? 0;
      const duration = svc?.duration ?? 40;
      setAddingStaffService({ serviceId, staffId });
      const staffName = staff.find((s) => s.id === staffId)?.name ?? '?';
      const tempLinkId = `temp-ss-${Date.now()}`;
      const prevMap = { ...staffServiceMap };
      const prevLinks = [...staffServiceLinks];
      try {
        setStaffServiceMap((m) => ({
          ...m,
          [serviceId]: [...(m[serviceId] ?? []), { linkId: tempLinkId, staffId, staffName, price, duration }],
        }));
        setStaffServiceLinks((list) => [...list, { id: tempLinkId, staffId, serviceId, price, duration }]);
        setAddStaffServiceId(null);
        const { id } = await addStaffService(token, staffId, serviceId, price, duration);
        setStaffServiceMap((m) => ({
          ...m,
          [serviceId]: (m[serviceId] ?? []).map((x) => (x.linkId === tempLinkId ? { ...x, linkId: id } : x)),
        }));
        setStaffServiceLinks((list) => list.map((l) => (l.id === tempLinkId ? { ...l, id } : l)));
        invalidateAdminCatalogWarm();
        return { success: true };
      } catch (e) {
        setStaffServiceMap(prevMap);
        setStaffServiceLinks(prevLinks);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו להוסיף' };
      } finally {
        setAddingStaffService(null);
      }
    },
    [token, staff, services, staffServiceMap, staffServiceLinks, addingStaffService]
  );

  const handleUpdateStaffService = useCallback(
    async (linkId: string, price: number, duration: number) => {
      if (!token) return { error: 'לא מחובר' };
      if (updatingStaffServiceId) return { error: 'ממתין...' };
      setUpdatingStaffServiceId(linkId);
      const link = staffServiceLinks.find((l) => l.id === linkId);
      const prevMap = { ...staffServiceMap };
      try {
        if (link) {
          setStaffServiceMap((m) => ({
            ...m,
            [link.serviceId]: (m[link.serviceId] ?? []).map((x) =>
              x.linkId === linkId ? { ...x, price, duration } : x
            ),
          }));
          setStaffServiceLinks((list) =>
            list.map((l) => (l.id === linkId ? { ...l, price, duration } : l))
          );
        }
        await updateStaffService(token, linkId, { price, duration });
        invalidateAdminCatalogWarm();
        return { success: true };
      } catch (e) {
        setStaffServiceMap(prevMap);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו לעדכן' };
      } finally {
        setUpdatingStaffServiceId(null);
      }
    },
    [token, staffServiceLinks, staffServiceMap, updatingStaffServiceId]
  );

  const handleRemoveStaffService = useCallback(
    async (linkId: string) => {
      if (!token) return { error: 'לא מחובר' };
      if (removingStaffServiceId) return { error: 'ממתין...' };
      setRemovingStaffServiceId(linkId);
      const link = staffServiceLinks.find((l) => l.id === linkId);
      const prevMap = { ...staffServiceMap };
      const prevLinks = [...staffServiceLinks];
      try {
        if (link) {
          setStaffServiceMap((m) => ({
            ...m,
            [link.serviceId]: (m[link.serviceId] ?? []).filter((x) => x.linkId !== linkId),
          }));
          setStaffServiceLinks((list) => list.filter((l) => l.id !== linkId));
        }
        await removeStaffService(token, linkId);
        invalidateAdminCatalogWarm();
        return { success: true };
      } catch (e) {
        setStaffServiceMap(prevMap);
        setStaffServiceLinks(prevLinks);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו להסיר' };
      } finally {
        setRemovingStaffServiceId(null);
      }
    },
    [token, staffServiceLinks, staffServiceMap, removingStaffServiceId]
  );

  const toggleWorkingDay = useCallback(
    async (staffId: string, dayOfWeek: number) => {
      if (!token) return;
      const key = `${staffId}-${dayOfWeek}`;
      if (togglingRef.current === key) return;
      togglingRef.current = key;
      setTogglingWorkingDay(key);

      const prev = staffWorkingDaysRef.current;
      const prevState: StaffWorkingDaysMap = {};
      for (const sid of Object.keys(prev)) {
        prevState[sid] = [...(prev[sid] ?? [])];
      }

      const staffDays = prev[staffId] ?? [];
      const exists = staffDays.some((d) => d.dayOfWeek === dayOfWeek);
      const nextMap: StaffWorkingDaysMap = { ...prev };
      if (exists) {
        nextMap[staffId] = staffDays.filter((d) => d.dayOfWeek !== dayOfWeek);
      } else {
        nextMap[staffId] = [
          ...staffDays,
          { id: `temp-${key}`, dayOfWeek, startTime: '09:00', endTime: '19:00' },
        ];
      }

      setStaffWorkingDays(nextMap);

      try {
        if (exists) {
          await removeStaffWorkingDayByDay(token, staffId, dayOfWeek);
        } else {
          await addStaffWorkingDay(token, staffId, dayOfWeek, '09:00', '19:00');
        }
        invalidateAdminCatalogWarm();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
          // Day already in DB - our optimistic add was correct, keep state
          invalidateAdminCatalogWarm();
        } else {
          setStaffWorkingDays(prevState);
        }
      } finally {
        togglingRef.current = null;
        setTogglingWorkingDay(null);
      }
    },
    [token]
  );

  const updateStaffWorkingDayTime = useCallback(
    async (staffId: string, dayOfWeek: number, startTime: string, endTime: string) => {
      if (!token) return;
      const key = `${staffId}-${dayOfWeek}`;
      if (updatingWorkingDayTime) return;
      const r = validateWorkingTimeRange(startTime, endTime);
      if (!r.valid) return;

      setUpdatingWorkingDayTime(key);
      const prev = staffWorkingDaysRef.current;
      const prevState: StaffWorkingDaysMap = {};
      for (const sid of Object.keys(prev)) {
        prevState[sid] = [...(prev[sid] ?? [])];
      }

      setStaffWorkingDays((m) => {
        const arr = m[staffId] ?? [];
        const existing = arr.find((x) => x.dayOfWeek === dayOfWeek);
        const next = existing
          ? arr.map((x) => (x.dayOfWeek === dayOfWeek ? { ...x, startTime, endTime } : x))
          : [...arr, { id: `temp-${key}`, dayOfWeek, startTime, endTime }];
        return { ...m, [staffId]: next };
      });

      try {
        await updateStaffWorkingDay(token, staffId, dayOfWeek, startTime, endTime);
        invalidateAdminCatalogWarm();
      } catch {
        setStaffWorkingDays(prevState);
      } finally {
        setUpdatingWorkingDayTime(null);
      }
    },
    [token, updatingWorkingDayTime]
  );

  return {
    activeTab,
    setActiveTab,
    branches,
    services,
    staff,
    branchStaffMap,
    staffServiceMap,
    deletingItemId,
    addingBranchStaff,
    addingStaffService,
    removingLinkId,
    removingStaffServiceId,
    addStaffBranch,
    addStaffServiceId,
    setAddStaffBranch,
    setAddStaffServiceId,
    loading,
    refreshing,
    onRefresh,
    modalVisible,
    setModalVisible,
    editItem,
    setEditItem,
    form,
    setForm,
    saving,
    openAdd,
    openEdit,
    handleSave,
    handleDelete,
    toggleStaffCanBlockOwnTime,
    togglingBlockPermissionId,
    toggleStaffCanSetOwnWorkingHours,
    togglingWorkingHoursPermissionId,
    handleAddBranchStaff,
    handleRemoveBranchStaff,
    handleAddStaffService,
    handleUpdateStaffService,
    handleRemoveStaffService,
    updatingStaffServiceId,
    staffWorkingDays,
    togglingWorkingDay,
    toggleWorkingDay,
    updatingWorkingDayTime,
    updateStaffWorkingDayTime,
  };
}
