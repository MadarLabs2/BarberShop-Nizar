import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CACHE_KEY_CATALOG_PRODUCTS, CacheService } from '../core/cache.service';
import { SupabaseService } from '../core/supabase';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { RequestUser } from '../auth/auth.decorator';
import type { UserPayload } from '../auth/auth.service';
import { AuthModule } from '../auth';

export type ProductPublicDto = {
  id: string;
  name: string;
  nameHe: string;
  nameAr: string;
  description: string | null;
  descriptionHe: string | null;
  descriptionAr: string | null;
  price: number;
  /** Set when on sale (less than `price`). */
  salePrice: number | null;
  imageUrl: string | null;
  category: string | null;
  stockQuantity: number;
  /** Null = public shop product (admin). */
  staffId: string | null;
  staffName: string | null;
};

export type ProductAdminDto = ProductPublicDto & {
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProductRow = {
  id: string;
  name: string;
  name_he: string;
  name_ar: string;
  description: string | null;
  description_he: string | null;
  description_ar: string | null;
  price: number;
  sale_price?: number | null;
  image_url: string | null;
  category: string | null;
  stock_quantity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  staff_id?: string | null;
};

type ProductRowWithStaff = ProductRow & {
  staff?: { name: string } | { name: string }[] | null;
};

const GUARDS = [TokenAuthGuard, AdminGuard];
const STAFF_GUARDS = [TokenAuthGuard, StaffGuard];

const PRODUCT_IMAGE_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TTL_CATALOG_PRODUCTS = 300;

const PRODUCT_PUBLIC_SELECT =
  'id, name, name_he, name_ar, description, description_he, description_ar, price, sale_price, image_url, category, stock_quantity, is_active, created_at, updated_at, staff_id';
const PRODUCT_PUBLIC_SELECT_WITH_STAFF =
  'id, name, name_he, name_ar, description, description_he, description_ar, price, sale_price, image_url, category, stock_quantity, is_active, created_at, updated_at, staff_id, staff(name)' as const;

function effectiveSalePrice(price: number, saleRaw: number | null | undefined): number | null {
  if (saleRaw == null || price <= 0) return null;
  const sp = Math.floor(Number(saleRaw));
  if (sp < 0 || sp >= price) return null;
  return sp;
}

/** Returns normalized sale price or null to store; throws if invalid. */
function normalizeSalePriceForDb(price: number, saleInput: number): number {
  if (price <= 0) throw new BadRequestException('Set a regular price before adding a sale');
  const sp = Math.floor(Number(saleInput));
  if (sp < 0) throw new BadRequestException('salePrice must be >= 0');
  if (sp >= price) throw new BadRequestException('salePrice must be less than price');
  return sp;
}

const ADMIN_ROW_SELECT =
  'id, name, name_he, name_ar, description, description_he, description_ar, price, sale_price, image_url, category, stock_quantity, is_active, created_at, updated_at, staff_id';

function extFromMime(mimetype: string): string {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  if (mimetype === 'image/gif') return 'gif';
  return 'jpg';
}

function normalizePhone(s: string): string {
  return String(s || '').replace(/\D/g, '').slice(-9) || '';
}

function staffNameFromRow(r: ProductRowWithStaff): string | null {
  const sid = r.staff_id ?? null;
  if (!sid) return null;
  const st = r.staff;
  if (!st) return null;
  if (Array.isArray(st)) return st[0]?.name ?? null;
  return st.name ?? null;
}


/** Extract the storage path from a full Supabase public URL.
 *  e.g. https://xxx.supabase.co/storage/v1/object/public/product-images/products/abc.jpg
 *  → "products/abc.jpg"
 */
function extractStoragePath(url: string, bucket: string): string | null {
  try {
    const marker = `/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.slice(idx + marker.length);
  } catch {
    return null;
  }
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  private mapPublic(r: ProductRowWithStaff): ProductPublicDto {
    const staffId = r.staff_id ?? null;
    return {
      id: r.id,
      name: r.name,
      nameHe: r.name_he,
      nameAr: r.name_ar,
      description: r.description ?? null,
      descriptionHe: r.description_he ?? null,
      descriptionAr: r.description_ar ?? null,
      price: r.price,
      salePrice: effectiveSalePrice(r.price, r.sale_price ?? null),
      imageUrl: r.image_url ?? null,
      category: r.category ?? null,
      stockQuantity: r.stock_quantity,
      staffId,
      staffName: staffNameFromRow(r),
    };
  }

  private mapAdmin(r: ProductRowWithStaff): ProductAdminDto {
    const price = r.price;
    const raw = r.sale_price ?? null;
    return {
      id: r.id,
      name: r.name,
      nameHe: r.name_he,
      nameAr: r.name_ar,
      description: r.description ?? null,
      descriptionHe: r.description_he ?? null,
      descriptionAr: r.description_ar ?? null,
      price,
      salePrice: raw != null && raw >= 0 && price > 0 && raw < price ? Math.floor(Number(raw)) : null,
      imageUrl: r.image_url ?? null,
      category: r.category ?? null,
      stockQuantity: r.stock_quantity,
      staffId: r.staff_id ?? null,
      staffName: null,
      isActive: r.is_active !== false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /** Guests & anonymous clients: admin shop catalog only (active, staff_id IS NULL). */
  async listPublic(): Promise<ProductPublicDto[]> {
    return this.cache.getOrSet(CACHE_KEY_CATALOG_PRODUCTS, TTL_CATALOG_PRODUCTS, async () => {
      const { data, error } = await this.supabase
        .getClient()
        .from('products')
        .select(PRODUCT_PUBLIC_SELECT)
        .is('staff_id', null)
        .eq('is_active', true)
        .order('name');
      if (error) return [];
      return (data || []).map((r: ProductRow) => this.mapPublic({ ...r, staff: null }));
    });
  }

  private async getConnectedStaffIds(user: UserPayload): Promise<string[]> {
    const phone = normalizePhone(user.phone);
    const client = this.supabase.getClient();
    let q = client.from('appointments').select('staff_id').not('staff_id', 'is', null);
    if (phone) {
      q = q.or(`profile_id.eq.${user.id},client_phone.eq.${phone}`);
    } else {
      q = q.eq('profile_id', user.id);
    }
    const { data, error } = await q;
    if (error || !data?.length) return [];
    const ids = new Set<string>();
    for (const row of data as { staff_id: string }[]) {
      if (row.staff_id) ids.add(row.staff_id);
    }
    return [...ids];
  }

  /**
   * Authenticated app users: same public shop products as everyone, plus barber-only rows
   * for staff they have appointments with. Shop segment always loaded first and never dropped.
   */
  async listForAuthenticatedUser(user: UserPayload): Promise<ProductPublicDto[]> {
    const client = this.supabase.getClient();

    const { data: globalRows, error: gErr } = await client
      .from('products')
      .select(PRODUCT_PUBLIC_SELECT)
      .is('staff_id', null)
      .eq('is_active', true)
      .order('name');

    const global: ProductPublicDto[] =
      !gErr && globalRows?.length
        ? (globalRows as ProductRow[]).map((r) => this.mapPublic({ ...r, staff: null }))
        : !gErr && globalRows
          ? []
          : [];

    const staffIds = await this.getConnectedStaffIds(user);
    if (staffIds.length === 0) return global;

    const { data: barberRows, error: bErr } = await client
      .from('products')
      .select(PRODUCT_PUBLIC_SELECT_WITH_STAFF)
      .in('staff_id', staffIds)
      .eq('is_active', true)
      .order('name');

    if (bErr || !barberRows?.length) return global;

    const barber = (barberRows as ProductRowWithStaff[])
      .map((r) => this.mapPublic(r))
      .sort((a, b) => {
        const an = a.staffName || '';
        const bn = b.staffName || '';
        if (an !== bn) return an.localeCompare(bn, 'he');
        return a.name.localeCompare(b.name, 'he');
      });

    return [...global, ...barber];
  }

  /** Admin UI: shop products only. */
  async listAdmin(): Promise<ProductAdminDto[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('products')
      .select(ADMIN_ROW_SELECT)
      .is('staff_id', null)
      .order('name');
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((r: ProductRow) => this.mapAdmin({ ...r, staff: null }));
  }

  async create(dto: {
    nameHe: string;
    nameAr: string;
    descriptionHe?: string;
    descriptionAr?: string;
    price: number;
    salePrice?: number | null;
    imageUrl?: string;
    category?: string;
    stockQuantity?: number;
  }): Promise<ProductAdminDto> {
    const nameHe = dto.nameHe?.trim();
    const nameAr = dto.nameAr?.trim();
    if (!nameHe) throw new BadRequestException('שם בעברית נדרש');
    if (!nameAr) throw new BadRequestException('שם בערבית נדרש');
    const price = Math.max(0, Math.floor(Number(dto.price) || 0));
    const stockQuantity = Math.max(0, Math.floor(Number(dto.stockQuantity ?? 0)));
    let sale_price: number | null = null;
    if (dto.salePrice !== undefined && dto.salePrice !== null) {
      sale_price = normalizeSalePriceForDb(price, dto.salePrice);
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('products')
      .insert({
        name: nameHe,
        name_he: nameHe,
        name_ar: nameAr,
        description: dto.descriptionHe?.trim() || null,
        description_he: dto.descriptionHe?.trim() || null,
        description_ar: dto.descriptionAr?.trim() || null,
        price,
        sale_price,
        image_url: dto.imageUrl?.trim() || null,
        category: dto.category?.trim() || null,
        stock_quantity: stockQuantity,
        staff_id: null,
      })
      .select(ADMIN_ROW_SELECT)
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.cache.invalidateCatalogAndAdmin();
    return this.mapAdmin(data as ProductRow);
  }

  async update(
    id: string,
    dto: {
      nameHe?: string;
      nameAr?: string;
      descriptionHe?: string;
      descriptionAr?: string;
      price?: number;
      salePrice?: number | null;
      imageUrl?: string;
      category?: string;
      stockQuantity?: number;
      isActive?: boolean;
    },
  ): Promise<ProductAdminDto> {
    const client = this.supabase.getClient();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.nameHe !== undefined) {
      const nameHe = dto.nameHe.trim();
      if (!nameHe) throw new BadRequestException('שם בעברית נדרש');
      updates.name_he = nameHe;
      updates.name = nameHe;
    }
    if (dto.nameAr !== undefined) {
      const nameAr = dto.nameAr.trim();
      if (!nameAr) throw new BadRequestException('שם בערבית נדרש');
      updates.name_ar = nameAr;
    }
    if (dto.descriptionHe !== undefined) {
      const descHe = dto.descriptionHe?.trim() || null;
      updates.description_he = descHe;
      updates.description = descHe;
    }
    if (dto.descriptionAr !== undefined) updates.description_ar = dto.descriptionAr?.trim() || null;
    if (dto.price !== undefined) updates.price = Math.max(0, Math.floor(Number(dto.price)));
    if (dto.imageUrl !== undefined) updates.image_url = dto.imageUrl?.trim() || null;
    if (dto.category !== undefined) updates.category = dto.category?.trim() || null;
    if (dto.stockQuantity !== undefined) updates.stock_quantity = Math.max(0, Math.floor(Number(dto.stockQuantity)));
    if (dto.isActive !== undefined) updates.is_active = !!dto.isActive;

    if (dto.salePrice !== undefined) {
      const nextPrice =
        dto.price !== undefined ? Math.max(0, Math.floor(Number(dto.price))) : undefined;
      let priceForSale = nextPrice;
      if (priceForSale === undefined) {
        const { data: cur } = await client.from('products').select('price').eq('id', id).is('staff_id', null).maybeSingle();
        priceForSale = cur ? (cur as { price: number }).price : 0;
      }
      if (dto.salePrice === null) {
        updates.sale_price = null;
      } else {
        updates.sale_price = normalizeSalePriceForDb(priceForSale, dto.salePrice);
      }
    } else if (dto.price !== undefined) {
      const newP = Math.max(0, Math.floor(Number(dto.price)));
      const { data: cur } = await client.from('products').select('sale_price').eq('id', id).is('staff_id', null).maybeSingle();
      const sp = (cur as { sale_price?: number | null } | null)?.sale_price;
      if (sp != null && sp >= newP) updates.sale_price = null;
    }

    let previousImageUrl: string | null = null;
    if (dto.imageUrl !== undefined) {
      const { data: cur } = await client.from('products').select('image_url').eq('id', id).is('staff_id', null).maybeSingle();
      previousImageUrl = (cur as { image_url?: string | null } | null)?.image_url ?? null;
    }

    const { data, error } = await client
      .from('products')
      .update(updates)
      .eq('id', id)
      .is('staff_id', null)
      .select(ADMIN_ROW_SELECT)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Product not found');
    await this.cache.invalidateCatalogAndAdmin();

    if (previousImageUrl && previousImageUrl !== updates.image_url) {
      const storagePath = extractStoragePath(previousImageUrl, PRODUCT_IMAGE_BUCKET);
      if (storagePath) await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]).catch(() => {});
    }

    return this.mapAdmin(data as ProductRow);
  }

  async deleteProduct(id: string): Promise<{ ok: boolean }> {
    const client = this.supabase.getClient();
    // Fetch image_url before deleting so we can remove the file from Storage
    const { data: existing } = await client
      .from('products')
      .select('id, image_url')
      .eq('id', id)
      .is('staff_id', null)
      .maybeSingle();
    if (!existing) throw new NotFoundException('Product not found');

    const { data, error } = await client
      .from('products')
      .delete()
      .eq('id', id)
      .is('staff_id', null)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new NotFoundException('Product not found');

    // Delete image from Storage (non-fatal — row is already deleted)
    const imageUrl = (existing as { image_url?: string | null }).image_url;
    if (imageUrl) {
      const storagePath = extractStoragePath(imageUrl, PRODUCT_IMAGE_BUCKET);
      if (storagePath) {
        await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]).catch(() => {});
      }
    }

    await this.cache.invalidateCatalogAndAdmin();
    return { ok: true };
  }

  async listStaffProducts(staffId: string): Promise<ProductAdminDto[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('products')
      .select(ADMIN_ROW_SELECT)
      .eq('staff_id', staffId)
      .order('name');
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((r: ProductRow) => this.mapAdmin({ ...r, staff: null }));
  }

  /**
   * Staff's own product listing — kept single-language in the UI (out of scope: the admin
   * dashboard is where the bilingual name/description fields were requested). `name_he`/`name_ar`
   * are still NOT NULL at the DB level though, so this mirrors the one name/description a staff
   * member enters into both columns — same "no auto-translation, just a safe placeholder" mirror
   * pattern the admin backfill migration uses, not a second real localization UI.
   */
  async createStaffProduct(
    staffId: string,
    dto: {
      name: string;
      description?: string;
      price: number;
      imageUrl?: string;
      category?: string;
      stockQuantity?: number;
    },
  ): Promise<ProductAdminDto> {
    if (!dto.name?.trim()) throw new BadRequestException('Name required');
    const name = dto.name.trim();
    const description = dto.description?.trim() || null;
    const price = Math.max(0, Math.floor(Number(dto.price) || 0));
    const stockQuantity = Math.max(0, Math.floor(Number(dto.stockQuantity ?? 0)));
    const { data, error } = await this.supabase
      .getClient()
      .from('products')
      .insert({
        name,
        name_he: name,
        name_ar: name,
        description,
        description_he: description,
        description_ar: description,
        price,
        image_url: dto.imageUrl?.trim() || null,
        category: dto.category?.trim() || null,
        stock_quantity: stockQuantity,
        staff_id: staffId,
      })
      .select(ADMIN_ROW_SELECT)
      .single();
    if (error) throw new BadRequestException(error.message);
    return this.mapAdmin(data as ProductRow);
  }

  async updateStaffProduct(
    staffId: string,
    id: string,
    dto: {
      name?: string;
      description?: string;
      price?: number;
      imageUrl?: string;
      category?: string;
      stockQuantity?: number;
      isActive?: boolean;
    },
  ): Promise<ProductAdminDto> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      updates.name = name;
      updates.name_he = name;
      updates.name_ar = name;
    }
    if (dto.description !== undefined) {
      const description = dto.description?.trim() || null;
      updates.description = description;
      updates.description_he = description;
      updates.description_ar = description;
    }
    if (dto.price !== undefined) updates.price = Math.max(0, Math.floor(Number(dto.price)));
    if (dto.imageUrl !== undefined) updates.image_url = dto.imageUrl?.trim() || null;
    if (dto.category !== undefined) updates.category = dto.category?.trim() || null;
    if (dto.stockQuantity !== undefined) updates.stock_quantity = Math.max(0, Math.floor(Number(dto.stockQuantity)));
    if (dto.isActive !== undefined) updates.is_active = !!dto.isActive;
    const client = this.supabase.getClient();

    let previousImageUrl: string | null = null;
    if (dto.imageUrl !== undefined) {
      const { data: cur } = await client.from('products').select('image_url').eq('id', id).eq('staff_id', staffId).maybeSingle();
      previousImageUrl = (cur as { image_url?: string | null } | null)?.image_url ?? null;
    }

    const { data, error } = await client
      .from('products')
      .update(updates)
      .eq('id', id)
      .eq('staff_id', staffId)
      .select(ADMIN_ROW_SELECT)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Product not found');

    if (previousImageUrl && previousImageUrl !== updates.image_url) {
      const storagePath = extractStoragePath(previousImageUrl, PRODUCT_IMAGE_BUCKET);
      if (storagePath) await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]).catch(() => {});
    }

    return this.mapAdmin(data as ProductRow);
  }

  async deleteStaffProduct(staffId: string, id: string): Promise<{ ok: boolean }> {
    const client = this.supabase.getClient();
    const { data: existing } = await client
      .from('products')
      .select('id, image_url')
      .eq('id', id)
      .eq('staff_id', staffId)
      .maybeSingle();
    if (!existing) throw new NotFoundException('Product not found');

    const { data, error } = await client
      .from('products')
      .delete()
      .eq('id', id)
      .eq('staff_id', staffId)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new NotFoundException('Product not found');

    const imageUrl = (existing as { image_url?: string | null }).image_url;
    if (imageUrl) {
      const storagePath = extractStoragePath(imageUrl, PRODUCT_IMAGE_BUCKET);
      if (storagePath) {
        await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]).catch(() => {});
      }
    }

    return { ok: true };
  }

  async uploadProductImage(file: Express.Multer.File): Promise<{ imageUrl: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('File required');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Image too large (max 5MB)');
    const mime = file.mimetype || 'image/jpeg';
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
      throw new BadRequestException('Invalid image type');
    }
    const ext = extFromMime(mime);
    const path = `products/${randomUUID()}.${ext}`;
    const client = this.supabase.getClient();
    const { error } = await client.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file.buffer, {
      contentType: mime,
      upsert: false,
      cacheControl: '31536000',
    });
    if (error) throw new BadRequestException(error.message);
    const { data } = client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new BadRequestException('Failed to resolve image URL');
    return { imageUrl: data.publicUrl };
  }
}

@Controller('catalog')
export class CatalogProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  listPublic() {
    return this.products.listPublic();
  }

  @Get('products/my')
  @UseGuards(TokenAuthGuard)
  listForUser(@RequestUser() user: UserPayload) {
    return this.products.listForAuthenticatedUser(user);
  }
}

@Controller('admin')
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  @UseGuards(...GUARDS)
  listAdmin() {
    return this.products.listAdmin();
  }

  @Post('products')
  @UseGuards(ThrottlerGuard, ...GUARDS)
  @Throttle({ writes: { limit: 40, ttl: 60_000 } })
  create(
    @Body()
    dto: {
      nameHe: string;
      nameAr: string;
      descriptionHe?: string;
      descriptionAr?: string;
      price: number;
      salePrice?: number | null;
      imageUrl?: string;
      category?: string;
      stockQuantity?: number;
    },
  ) {
    return this.products.create(dto);
  }

  @Patch('products/:id')
  @UseGuards(...GUARDS)
  update(
    @Param('id') id: string,
    @Body()
    dto: {
      nameHe?: string;
      nameAr?: string;
      descriptionHe?: string;
      descriptionAr?: string;
      price?: number;
      salePrice?: number | null;
      imageUrl?: string;
      category?: string;
      stockQuantity?: number;
      isActive?: boolean;
    },
  ) {
    return this.products.update(id, dto);
  }

  @Delete('products/:id')
  @UseGuards(...GUARDS)
  remove(@Param('id') id: string) {
    return this.products.deleteProduct(id);
  }

  @Post('products/upload-image')
  @UseGuards(ThrottlerGuard, ...GUARDS)
  @Throttle({ writes: { limit: 36, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.products.uploadProductImage(file);
  }
}

@Controller('admin')
export class StaffProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('my-products')
  @UseGuards(...STAFF_GUARDS)
  listMine(@RequestUser() user: UserPayload) {
    return this.products.listStaffProducts(user.staffId!);
  }

  @Post('my-products')
  @UseGuards(ThrottlerGuard, ...STAFF_GUARDS)
  @Throttle({ writes: { limit: 40, ttl: 60_000 } })
  createMine(
    @RequestUser() user: UserPayload,
    @Body()
    dto: {
      name: string;
      description?: string;
      price: number;
      imageUrl?: string;
      category?: string;
      stockQuantity?: number;
    },
  ) {
    return this.products.createStaffProduct(user.staffId!, dto);
  }

  @Patch('my-products/:id')
  @UseGuards(...STAFF_GUARDS)
  updateMine(
    @RequestUser() user: UserPayload,
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      description?: string;
      price?: number;
      imageUrl?: string;
      category?: string;
      stockQuantity?: number;
      isActive?: boolean;
    },
  ) {
    return this.products.updateStaffProduct(user.staffId!, id, dto);
  }

  @Delete('my-products/:id')
  @UseGuards(...STAFF_GUARDS)
  removeMine(@RequestUser() user: UserPayload, @Param('id') id: string) {
    return this.products.deleteStaffProduct(user.staffId!, id);
  }

  @Post('my-products/upload-image')
  @UseGuards(ThrottlerGuard, ...STAFF_GUARDS)
  @Throttle({ writes: { limit: 36, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.products.uploadProductImage(file);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [CatalogProductsController, AdminProductsController, StaffProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
