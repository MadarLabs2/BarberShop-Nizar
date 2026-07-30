import { createRequire } from 'module';
import * as fs from 'node:fs';
import * as path from 'path';
import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
/* pdfkit is CJS (`module.exports = PDFDocument`) — default import becomes `.default` and breaks at runtime */
import PDFDocument = require('pdfkit');
import { SupabaseService } from '../core/supabase';
import { israelDateTimeToEpochMs } from '../core/israel-time';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { RequestUser } from '../auth/auth.decorator';
import { AuthModule } from '../auth';

const ADMIN_GUARDS = [TokenAuthGuard, AdminGuard];
const REPORT_TZ = 'Asia/Jerusalem';
/** Row cap for the appointment detail table — shared with the Arabic footnote that quotes this number. */
const MAX_REPORT_ROWS = 500;

const nodeRequire = createRequire(__filename);

function resolveHebrewFontPath(): string {
  const pkgJson = nodeRequire.resolve('@expo-google-fonts/rubik/package.json');
  return path.join(path.dirname(pkgJson), '400Regular', 'Rubik_400Regular.ttf');
}

function resolveHebrewFontBoldPath(): string {
  const pkgJson = nodeRequire.resolve('@expo-google-fonts/rubik/package.json');
  return path.join(path.dirname(pkgJson), '700Bold', 'Rubik_700Bold.ttf');
}

/** Elegant Hebrew serif for headings only — body/table text stays on the plainer Rubik sans for readability. */
function resolveHebrewDisplayFontPath(): string {
  const pkgJson = nodeRequire.resolve('@expo-google-fonts/frank-ruhl-libre/package.json');
  return path.join(path.dirname(pkgJson), '700Bold', 'FrankRuhlLibre_700Bold.ttf');
}

function resolveArabicFontPath(): string {
  const pkgJson = nodeRequire.resolve('@expo-google-fonts/noto-sans-arabic/package.json');
  return path.join(path.dirname(pkgJson), '400Regular', 'NotoSansArabic_400Regular.ttf');
}

function resolveArabicFontBoldPath(): string {
  const pkgJson = nodeRequire.resolve('@expo-google-fonts/noto-sans-arabic/package.json');
  return path.join(path.dirname(pkgJson), '700Bold', 'NotoSansArabic_700Bold.ttf');
}

type PdfLang = 'he' | 'ar';

function normalizePdfLang(raw?: string): PdfLang {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'ar' || s.startsWith('ar-')) return 'ar';
  return 'he';
}

function formatReportDateYmd(ymd: string, lang: PdfLang): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, mo, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, mo - 1, d);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(dt);
}

function formatDateForHebrewReport(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  return `${d}.${m}.${y}`;
}

function formatReportTimeHm(hmRaw: string, lang: PdfLang): string {
  const hm = String(hmRaw || '').slice(0, 5);
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return hm;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const dt = new Date(2020, 0, 1, h, min);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt);
}

function formatPdfInteger(n: number, lang: PdfLang): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL', { maximumFractionDigits: 0 }).format(n);
}

function formatPdfMoney(amount: number, lang: PdfLang): string {
  return `₪ ${formatPdfInteger(amount, lang)}`;
}

function rtlText(s: string): string {
  return String(s || '');
}

function ltrText(s: string): string {
  return String(s || '');
}

/**
 * Collapse whitespace. For Hebrew-only tokens with no space (common DB glitch),
 * insert a space before the last 3 letters when length 7–10 (typical given + 3-letter family).
 */
function tidyPersonName(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function formatGeneratedInTz(iso: string, lang: PdfLang): string {
  const d = new Date(iso);
  const locale = lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL';
  return new Intl.DateTimeFormat(locale, {
    timeZone: REPORT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function formatDateTimeForHebrewReport(iso: string): { datePart: string; timePart: string } {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return { datePart, timePart };
}

function statusLabelPdf(status: string, lang: PdfLang): string {
  const st = (status || 'confirmed').trim() || 'confirmed';
  if (lang === 'ar') {
    if (st === 'confirmed') return 'مؤكد';
    if (st === 'completed') return 'مكتمل';
    if (st === 'cancelled') return 'ملغى';
    return st;
  }
  if (st === 'confirmed') return 'מאושר';
  if (st === 'completed') return 'הושלם';
  if (st === 'cancelled') return 'בוטל';
  return st;
}

const PDF_LABELS: Record<
  PdfLang,
  {
    docTitle: string;
    docSub1: string;
    docSub2: string;
    periodFrom: string;
    periodTo: string;
    generatedPrefix: string;
    summaryTitle: string;
    totalAppts: string;
    countConfirmed: string;
    countNotCompletedOrCancelled: string;
    revenuePrefix: string;
    revenueFoot: string;
    detailTitle: string;
    detailFoot: string;
    empty: string;
    tableCols: [string, string, string, string, string];
    blockedTitle: string;
    blockedFoot: string;
    blockedEmpty: string;
    blockedCols: [string, string, string];
  }
> = {
  he: {
    docTitle: 'פעילות ודוחות',
    docSub1: 'איש צוות',
    docSub2: 'סיכום ביצועים לצוות',
    periodFrom: 'תקופת הדוח:',
    periodTo: '–',
    generatedPrefix: 'הופק בתאריך:',
    summaryTitle: 'סיכום פעילות',
    totalAppts: 'תורים מאושרים',
    countConfirmed: 'תורים מאושרים',
    countNotCompletedOrCancelled: 'תורים שבוטלו או לא הושלמו',
    revenuePrefix: 'הכנסות משוערות:',
    revenueFoot: 'הנתונים מבוססים על תורים מאושרים או תורים שסומנו כשולמו במערכת.',
    detailTitle: 'פירוט תורים',
    detailFoot: 'רשימת התורים שנכללו בחישוב ההכנסות לתקופת הדוח',
    empty: 'אין תורים להצגה בטווח שנבחר.',
    tableCols: ['תאריך', 'שעה', 'לקוח', 'סטטוס', 'סכום'],
    blockedTitle: 'היסטוריית זמנים חסומים',
    blockedFoot: 'רשימת חסימות הזמן שנקבעו לאיש הצוות בתקופת הדוח, כולל חסימות שכבר חלפו.',
    blockedEmpty: 'אין חסימות זמן להצגה בטווח שנבחר.',
    blockedCols: ['תאריך', 'משעה', 'עד שעה'],
  },
  ar: {
    docTitle: 'تقرير النشاط',
    docSub1: 'موظف',
    docSub2: 'ملخص المواعيد والإيرادات',
    periodFrom: 'من تاريخ:',
    periodTo: 'حتى تاريخ:',
    generatedPrefix: 'وقت الإصدار:',
    summaryTitle: 'الملخص',
    totalAppts: 'إجمالي المواعيد (مؤكد + مكتمل):',
    countConfirmed: 'مؤكد',
    countNotCompletedOrCancelled: 'غير مكتمل/ملغى',
    revenuePrefix: 'إيرادات تقديرية:',
    revenueFoot: 'تُحسب من المواعيد المكتملة أو المؤكدة التي مرّ وقتها.',
    detailTitle: 'تفاصيل المواعيد',
    detailFoot: 'يُعرض المواعيد المؤكدة أو المكتملة فقط (حتى 500 سجل).',
    empty: 'لا توجد مواعيد لعرضها في النطاق المحدد.',
    tableCols: ['التاريخ', 'الوقت', 'العميل', 'الحالة', 'المبلغ'],
    blockedTitle: 'سجل أوقات الحظر',
    blockedFoot: 'قائمة أوقات الحظر المحددة لهذا الموظف خلال فترة التقرير، بما في ذلك ما انتهى منها.',
    blockedEmpty: 'لا توجد أوقات محظورة لعرضها في النطاق المحدد.',
    blockedCols: ['التاريخ', 'من الساعة', 'إلى الساعة'],
  },
};

function formatYmdInTz(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function startOfMonthYmdInTz(timeZone: string): string {
  const today = formatYmdInTz(new Date(), timeZone);
  const [y, m] = today.split('-').map((x) => parseInt(x, 10));
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function appointmentStartMs(date: string, time: string): number {
  return israelDateTimeToEpochMs(date, time);
}

export type StaffReportAppointmentRow = {
  id: string;
  date: string;
  time: string;
  clientName: string;
  status: string;
  price: number | null;
};

/** Historical record of a blocked-time entry — kept here since the live "manage blocks" screen only
 * shows entries still in effect (see `AdminScheduleService.getMyBlockedSlots`); this report is where
 * past blocks remain visible. */
export type StaffReportBlockedSlotRow = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type StaffReportPayload = {
  staffId: string;
  staffName: string;
  from: string;
  to: string;
  generatedAt: string;
  /** Confirmed + completed only (cancelled excluded). */
  counts: { total: number; confirmed: number; completed: number };
  /** Sum of `price` for completed, or confirmed appointments whose scheduled start is already in the past. */
  revenueAgendaShekels: number;
  appointments: StaffReportAppointmentRow[];
  blockedSlots: StaffReportBlockedSlotRow[];
};

type AptRow = {
  id: string;
  date: string;
  time: string;
  client_name: string | null;
  service_name: string | null;
  branch_name: string | null;
  status: string | null;
  price: number | null;
};

type BlockedSlotRow = {
  id: string;
  date: string;
  time: string;
  duration: number | null;
};

function addMinutesToHHMM(hhmm: string, minutesToAdd: number): string {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const total = (h || 0) * 60 + (m || 0) + minutesToAdd;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const eh = Math.floor(wrapped / 60);
  const em = wrapped % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

@Injectable()
export class StaffReportsService {
  constructor(private readonly supabase: SupabaseService) {}

  private normalizeRange(fromRaw?: string, toRaw?: string): { from: string; to: string } {
    const today = formatYmdInTz(new Date(), REPORT_TZ);
    let from = (fromRaw || '').trim();
    let to = (toRaw || '').trim();
    if (!to) to = today;
    if (!from) from = startOfMonthYmdInTz(REPORT_TZ);
    if (!isYmd(from) || !isYmd(to)) throw new BadRequestException('Invalid date format (YYYY-MM-DD)');
    if (from > to) [from, to] = [to, from];
    const startMs = new Date(`${from}T00:00:00`).getTime();
    const endMs = new Date(`${to}T00:00:00`).getTime();
    const days = (endMs - startMs) / (86400 * 1000);
    if (days > 366) throw new BadRequestException('Date range too large (max 366 days)');
    return { from, to };
  }

  private revenueAgendaShekels(rows: AptRow[], nowMs: number): number {
    let revenue = 0;
    for (const r of rows) {
      const st = (r.status || '').trim() || 'confirmed';
      const price = typeof r.price === 'number' && !Number.isNaN(r.price) ? r.price : 0;
      const past = appointmentStartMs(r.date, String(r.time || '')) < nowMs;
      if (st === 'completed' || (st === 'confirmed' && past)) revenue += price;
    }
    return revenue;
  }

  private isActiveAppointmentStatus(status: string | null | undefined): boolean {
    const st = (status || '').trim() || 'confirmed';
    return st === 'confirmed' || st === 'completed';
  }

  async buildReport(
    staffId: string,
    fromRaw?: string,
    toRaw?: string,
    opts?: { clientPlaceholderLang?: PdfLang },
  ): Promise<StaffReportPayload> {
    const { from, to } = this.normalizeRange(fromRaw, toRaw);
    const clientPh = opts?.clientPlaceholderLang === 'ar' ? 'عميل' : 'לקוח';
    const client = this.supabase.getClient();
    const { data: staffRow, error: staffErr } = await client.from('staff').select('id, name').eq('id', staffId).maybeSingle();
    if (staffErr || !staffRow) throw new NotFoundException('Staff not found');
    const staffName = tidyPersonName(String((staffRow as { name?: string }).name || ''));

    const { data: aptData, error: aptErr } = await client
      .from('appointments')
      .select('id, date, time, client_name, service_name, branch_name, status, price')
      .eq('staff_id', staffId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('time', { ascending: false })
      .limit(800);
    if (aptErr) throw new BadRequestException(aptErr.message);

    const rows = (aptData || []) as AptRow[];
    const nowMs = Date.now();
    const revenueAgendaShekels = this.revenueAgendaShekels(rows, nowMs);

    const activeRows = rows.filter((r) => this.isActiveAppointmentStatus(r.status));
    let confirmed = 0;
    let completed = 0;
    for (const r of activeRows) {
      const st = (r.status || '').trim() || 'confirmed';
      if (st === 'confirmed') confirmed += 1;
      else if (st === 'completed') completed += 1;
    }

    const appointments: StaffReportAppointmentRow[] = activeRows.slice(0, MAX_REPORT_ROWS).map((r) => ({
      id: r.id,
      date: r.date,
      time: typeof r.time === 'string' ? r.time.slice(0, 5) : String(r.time || '').slice(0, 5),
      clientName: tidyPersonName((r.client_name || clientPh).trim() || clientPh),
      status: (r.status || 'confirmed').trim() || 'confirmed',
      price: typeof r.price === 'number' ? r.price : null,
    }));

    const { data: blockedData, error: blockedErr } = await client
      .from('blocked_slots')
      .select('id, date, time, duration')
      .eq('staff_id', staffId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('time', { ascending: false })
      .limit(MAX_REPORT_ROWS);
    if (blockedErr) throw new BadRequestException(blockedErr.message);

    const blockedSlots: StaffReportBlockedSlotRow[] = ((blockedData || []) as BlockedSlotRow[]).map((r) => {
      const startTime = typeof r.time === 'string' ? r.time.slice(0, 5) : String(r.time || '').slice(0, 5);
      return {
        id: r.id,
        date: r.date,
        startTime,
        endTime: addMinutesToHHMM(startTime, r.duration || 40),
      };
    });

    return {
      staffId,
      staffName,
      from,
      to,
      generatedAt: new Date().toISOString(),
      counts: {
        total: activeRows.length,
        confirmed,
        completed,
      },
      revenueAgendaShekels,
      appointments,
      blockedSlots,
    };
  }

  private renderPdf(report: StaffReportPayload, lang: PdfLang): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const L = PDF_LABELS[lang];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 54,
      autoFirstPage: true,
      bufferPages: true,
      info: { Title: L.docTitle, Creator: 'CarVision' },
    });
    doc.on('data', (c: Buffer) => chunks.push(c));

    const ACCENT = '#c9a227';
    const INK = '#1a1917';
    const MUTED = '#5c5a55';
    const BORDER = '#e3dfd6';
    const TABLE_HEAD = '#ebe8e0';
    const ROW_ALT = '#f7f5f0';
    const SOFT_INK = '#2f2d29';
    const BODY_MUTED = '#6a665f';
    /** Muted warning red for cancelled amounts only — everything else stays plain ink, like a printed ledger. */
    const RED = '#9a4a41';

    const statusTextColor = (status: string): string => {
      const st = (status || '').trim() || 'confirmed';
      if (st === 'cancelled') return RED;
      return SOFT_INK;
    };

    const pageInnerW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    let y = doc.page.margins.top;

    const ensureSpace = (need: number) => {
      const bottom = doc.page.height - doc.page.margins.bottom;
      if (y + need > bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    };

    const hePath = resolveHebrewFontPath();
    const heBoldPath = resolveHebrewFontBoldPath();
    let arPath = '';
    let arBoldPath = '';
    let arOk = false;
    let arBoldOk = false;
    try {
      arPath = resolveArabicFontPath();
      arBoldPath = resolveArabicFontBoldPath();
      arOk = fs.existsSync(arPath);
      arBoldOk = fs.existsSync(arBoldPath);
    } catch {
      arOk = false;
      arBoldOk = false;
    }
    const heBoldOk = fs.existsSync(heBoldPath);

    let heDisplayOk = false;
    try {
      const heDisplayPath = resolveHebrewDisplayFontPath();
      heDisplayOk = fs.existsSync(heDisplayPath);
      if (heDisplayOk) doc.registerFont('he-display', heDisplayPath);
    } catch {
      heDisplayOk = false;
    }

    doc.registerFont('he', hePath);
    if (heBoldOk) doc.registerFont('he-b', heBoldPath);
    if (arOk) doc.registerFont('ar', arPath);
    if (arBoldOk) doc.registerFont('ar-b', arBoldPath);

    const uiBold = (): string => {
      if (lang === 'ar') return arBoldOk ? 'ar-b' : arOk ? 'ar' : heBoldOk ? 'he-b' : 'he';
      return heBoldOk ? 'he-b' : 'he';
    };
    const uiReg = (): string => {
      if (lang === 'ar') return arOk ? 'ar' : 'he';
      return 'he';
    };
    /** Elegant serif for the masthead title, staff name, and section headings \u2014 not body/table text. */
    const uiDisplay = (): string => {
      if (lang === 'he') return heDisplayOk ? 'he-display' : uiBold();
      return uiBold();
    };

    const pickTitleFont = (text: string): string => {
      const t = (text || '').trim();
      if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t)) return arBoldOk ? 'ar-b' : arOk ? 'ar' : heBoldOk ? 'he-b' : 'he';
      // Frank Ruhl Libre covers Hebrew + Latin, so names in either script get the same elegant serif treatment.
      return heDisplayOk ? 'he-display' : uiBold();
    };

    const pickCellFont = (text: string): string => {
      const t = text || '';
      if (/[\u0590-\u05FF]/.test(t)) return 'he';
      if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t)) return arOk ? 'ar' : 'he';
      // Script-neutral content (dates, times, \u20AA amounts): Rubik covers digits/currency
      // symbols more completely than Noto Sans Arabic, which has no glyph for \u20AA (U+20AA).
      return 'he';
    };

    const font = (id: string) => doc.font(id);
    const heNbsp = (s: string): string => String(s || '').replace(/\s+/g, '\u00A0').trim();
    /** No RLE/LRI/PDF control chars — Noto in PDFKit draws them as empty boxes (tofu). */
    // Arabic is RTL too and hits the identical PDFKit word-gluing bug as Hebrew, so this
    // non-breaking-space protection applies regardless of `lang`, not just for Hebrew.
    const rtlLabel = (s: string): string => heNbsp(s);
    const rtlValue = (s: string): string => heNbsp(s);

    /**
     * Renders a right-to-left line from segments (Hebrew/Arabic labels interleaved with
     * Latin dates/times) as separate positioned draws, right edge first. Two independent
     * PDFKit/fontkit quirks are worked around here:
     *  1. A single mixed-script string reverses embedded LTR digit runs character-by-character
     *     (e.g. "19.7.2026" becomes "6202.7.91") — fixed by measuring/placing each run ourselves.
     *  2. fontkit reverses glyphs per RTL "word", and PDFKit's line-breaker splits words on a
     *     regular space, so any multi-word Hebrew segment (e.g. "תקופת הדוח:") renders with its
     *     two words glued together in swapped order — fixed by using heNbsp() on each segment,
     *     which turns internal spaces into non-breaking spaces so the whole segment stays one run.
     */
    const drawBidiLine = (segments: string[], xx: number, yy: number, width: number): void => {
      const spaceWidth = doc.widthOfString(' ');
      let cursorRight = xx + width;
      for (const raw of segments) {
        const seg = heNbsp(raw);
        const w = doc.widthOfString(seg);
        const segX = cursorRight - w;
        doc.text(seg, segX, yy, { lineBreak: false, width: w + 4 });
        cursorRight = segX - spaceWidth;
      }
    };

    const drawLine = (yy: number) => {
      doc.save();
      doc.strokeColor(BORDER).lineWidth(0.5).moveTo(left, yy).lineTo(left + pageInnerW, yy).stroke();
      doc.restore();
    };

    const titleTextOpts = (width: number) => ({ width, align: 'right' as const, lineGap: 4, characterSpacing: 0.2 });
    const subtitleTextOpts = (width: number) => ({ width, align: 'right' as const, lineGap: 3, characterSpacing: 0.1 });
    const bodyTextOpts = (width: number) => ({ width, align: 'right' as const, lineGap: 3 });


    // Letterhead header: light cream card with a gold rule, not a solid dark band —
    // reads as a printed letterhead rather than an app dashboard banner.
    const padX = 22;
    const headerH = 132;
    doc.save();
    doc.rect(left, y, pageInnerW, headerH).fill('#faf8f5');
    doc.rect(left, y, pageInnerW, headerH).strokeColor(BORDER).lineWidth(1).stroke();
    doc.restore();
    font(uiDisplay());
    doc.fillColor(INK).fontSize(24).text(rtlLabel(L.docTitle), left + padX, y + 18, titleTextOpts(pageInnerW - padX * 2));
    const nameRaw = (report.staffName || '—').trim() || '—';
    font(pickTitleFont(nameRaw));
    doc.fillColor(ACCENT).fontSize(15).text(rtlValue(nameRaw), left + padX, y + 52, titleTextOpts(pageInnerW - padX * 2));
    font(uiReg());
    doc.fontSize(9.5).fillColor(BODY_MUTED);
    const fromLabel = lang === 'he' ? formatDateForHebrewReport(report.from) : formatReportDateYmd(report.from, lang);
    const toLabel = lang === 'he' ? formatDateForHebrewReport(report.to) : formatReportDateYmd(report.to, lang);
    drawBidiLine([L.periodFrom, fromLabel, L.periodTo, toLabel], left + padX, y + 80, pageInnerW - padX * 2);
    if (lang === 'he') {
      const { datePart, timePart } = formatDateTimeForHebrewReport(report.generatedAt);
      drawBidiLine([L.generatedPrefix, datePart, 'בשעה', timePart], left + padX, y + 98, pageInnerW - padX * 2);
    } else {
      drawBidiLine([L.generatedPrefix, formatGeneratedInTz(report.generatedAt, lang)], left + padX, y + 98, pageInnerW - padX * 2);
    }
    doc.save();
    doc.rect(left, y + headerH, pageInnerW, 3).fill(ACCENT);
    doc.restore();
    font(uiReg());
    doc.fillColor(INK);
    y += headerH + 3 + 28;

    // KPI stat cards: confirmed / cancelled-or-incomplete / revenue, side by side.
    const notCompletedOrCancelled = Math.max(0, report.counts.total - report.counts.confirmed - report.counts.completed);
    const cardGap = 14;
    const cardW = (pageInnerW - cardGap * 2) / 3;
    const cardH = 90;
    ensureSpace(cardH + 8);
    const cardTop = y;
    const cards: { value: string; label: string; primary?: boolean }[] = [
      { value: formatPdfInteger(report.counts.confirmed, lang), label: L.countConfirmed },
      { value: formatPdfInteger(notCompletedOrCancelled, lang), label: L.countNotCompletedOrCancelled },
      { value: formatPdfMoney(report.revenueAgendaShekels, lang), label: L.revenuePrefix.replace(/:\s*$/, ''), primary: true },
    ];
    for (let i = 0; i < 3; i++) {
      const cardX = left + pageInnerW - (i + 1) * cardW - i * cardGap;
      doc.save();
      doc.rect(cardX, cardTop, cardW, cardH).fill(cards[i].primary ? '#faf5e7' : '#faf8f5');
      doc.rect(cardX, cardTop, cardW, cardH).strokeColor(BORDER).lineWidth(1).stroke();
      doc.rect(cardX + cardW - 3, cardTop, 3, cardH).fill(ACCENT);
      doc.restore();
      // Card values are script-neutral (digits, optionally ₪) — always use Rubik, which has
      // a ₪ glyph, rather than uiBold()'s Arabic-preferring choice (Noto Sans Arabic lacks one).
      font(heBoldOk ? 'he-b' : 'he');
      doc.fontSize(21).fillColor(SOFT_INK).text(cards[i].value, cardX + 12, cardTop + 20, { width: cardW - 24, align: 'right' });
      font(uiReg());
      doc.fontSize(9).fillColor(BODY_MUTED).text(rtlLabel(cards[i].label), cardX + 12, cardTop + 52, { width: cardW - 24, align: 'right', lineGap: 2 });
    }
    font(uiReg());
    y = cardTop + cardH + 14;
    doc.fontSize(9).fillColor(BODY_MUTED).text(rtlLabel(L.revenueFoot), left, y, bodyTextOpts(pageInnerW));
    doc.fillColor(INK);
    y += 30;
    drawLine(y);
    y += 24;

    const colWDate = 76;
    const colWTime = 52;
    const colWStatus = 56;
    const colWPrice = 52;
    const colWClient = pageInnerW - colWDate - colWTime - colWStatus - colWPrice;

    const colXsRtl = (): number[] => {
      const xs: number[] = [];
      let x = left + pageInnerW;
      for (const w of [colWDate, colWTime, colWClient, colWStatus, colWPrice]) {
        x -= w;
        xs.push(x);
      }
      return xs;
    };

    /** RTL table: column boundaries at inner verticals (pdf x increases left→right; date column is visually first on the right). */
    const strokeTableColumnDividers = (top: number, h: number) => {
      const xs = colXsRtl();
      doc.save();
      doc.strokeColor(BORDER).lineWidth(0.35);
      for (let i = 1; i < 5; i++) {
        const vx = xs[i];
        doc.moveTo(vx, top).lineTo(vx, top + h).stroke();
      }
      doc.restore();
    };

    ensureSpace(44);
    font(uiDisplay());
    doc.fontSize(15).fillColor(SOFT_INK).text(rtlLabel(L.detailTitle), left, y, titleTextOpts(pageInnerW));
    font(uiReg());
    y += 20;
    doc.fontSize(9.5).fillColor(BODY_MUTED);
    if (lang === 'ar') {
      // Arabic phrasing embeds the row cap mid-sentence; rendered as one string the LTR
      // number gets swept into the RTL run and reversed (500 -> 005), so split it out.
      drawBidiLine(
        ['يُعرض المواعيد المؤكدة أو المكتملة فقط (حتى', String(MAX_REPORT_ROWS), 'سجل).'],
        left,
        y,
        pageInnerW,
      );
    } else {
      doc.text(rtlLabel(L.detailFoot), left, y, bodyTextOpts(pageInnerW));
    }
    doc.fillColor(INK);
    y += 18;

    const cellPadX = 8;
    const rowH = 28;
    const headH = 30;
    const tableHeadLabels = L.tableCols;

    const drawTableHeader = () => {
      const xs = colXsRtl();
      const widths = [colWDate, colWTime, colWClient, colWStatus, colWPrice];
      doc.save();
      doc.rect(left, y, pageInnerW, headH).fill(TABLE_HEAD);
      doc.rect(left, y, pageInnerW, headH).strokeColor(BORDER).lineWidth(0.5).stroke();
      strokeTableColumnDividers(y, headH);
      doc.fillColor(INK);
      font(uiBold());
      doc.fontSize(10);
      for (let i = 0; i < 5; i++) {
        doc.text(rtlLabel(tableHeadLabels[i]), xs[i] + cellPadX, y + 9, {
          width: widths[i] - cellPadX * 2,
          align: 'right',
          lineGap: 2,
          characterSpacing: 0.1,
        });
      }
      font(uiReg());
      doc.restore();
      y += headH;
    };

    const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
    const ensureSpaceForTableRow = () => {
      if (y + rowH + 2 <= bottomLimit()) return;
      doc.addPage();
      y = doc.page.margins.top;
      drawTableHeader();
    };

    if (report.appointments.length === 0) {
      const emptyH = 130;
      ensureSpace(emptyH + 8);
      const emptyTop = y;
      doc.save();
      doc.rect(left, emptyTop, pageInnerW, emptyH).fill('#faf8f5');
      doc.dash(4, { space: 3 }).rect(left, emptyTop, pageInnerW, emptyH).strokeColor(BORDER).lineWidth(1).stroke();
      doc.undash();
      doc.restore();
      font(uiReg());
      doc.fontSize(11).fillColor(BODY_MUTED);
      doc.text(rtlLabel(L.empty), left + 24, emptyTop + emptyH / 2 - 8, bodyTextOpts(pageInnerW - 48));
      doc.fillColor(INK);
      y = emptyTop + emptyH + 20;
    } else {
      ensureSpace(headH + rowH + 4);
      drawTableHeader();

      let rowIdx = 0;
      for (const a of report.appointments) {
        ensureSpaceForTableRow();
        const xs = colXsRtl();
        const widths = [colWDate, colWTime, colWClient, colWStatus, colWPrice];
        if (rowIdx % 2 === 1) {
          doc.save();
          doc.rect(left, y, pageInnerW, rowH).fill(ROW_ALT);
          doc.restore();
        }
        doc.save();
        doc.rect(left, y, pageInnerW, rowH).strokeColor(BORDER).lineWidth(0.35).stroke();
        strokeTableColumnDividers(y, rowH);
        doc.fillColor(SOFT_INK);
        doc.fontSize(9.5);
        const st = statusLabelPdf(a.status, lang);
        const rawCells: [string, string, string, string, string] = [
          ltrText(lang === 'he' ? formatDateForHebrewReport(a.date) : formatReportDateYmd(a.date, lang)),
          ltrText(formatReportTimeHm(a.time, lang)),
          rtlValue(a.clientName),
          rtlLabel(st),
          a.price != null ? formatPdfMoney(a.price, lang) : '—',
        ];
        for (let i = 0; i < 5; i++) {
          font(pickCellFont(rawCells[i]));
          doc.fillColor(i === 3 ? statusTextColor(a.status) : SOFT_INK);
          doc.text(rawCells[i], xs[i] + cellPadX, y + 9, {
            width: widths[i] - cellPadX * 2,
            align: 'right',
            lineGap: 2,
          });
        }
        doc.fillColor(SOFT_INK);
        font(uiReg());
        doc.restore();
        y += rowH;
        rowIdx += 1;
      }
    }

    // Blocked-time history — the live "manage blocks" screen only shows entries still in effect;
    // this is where past blocks for the report period remain visible.
    ensureSpace(44);
    font(uiDisplay());
    doc.fontSize(15).fillColor(SOFT_INK).text(rtlLabel(L.blockedTitle), left, y, titleTextOpts(pageInnerW));
    font(uiReg());
    y += 20;
    doc.fontSize(9.5).fillColor(BODY_MUTED);
    doc.text(rtlLabel(L.blockedFoot), left, y, bodyTextOpts(pageInnerW));
    doc.fillColor(INK);
    y += 18;

    const blockedColWDate = 90;
    const blockedColWStart = (pageInnerW - 90) / 2;
    const blockedColWEnd = pageInnerW - blockedColWDate - blockedColWStart;

    const blockedColXsRtl = (): number[] => {
      const xs: number[] = [];
      let x = left + pageInnerW;
      for (const w of [blockedColWDate, blockedColWStart, blockedColWEnd]) {
        x -= w;
        xs.push(x);
      }
      return xs;
    };

    const strokeBlockedColumnDividers = (top: number, h: number) => {
      const xs = blockedColXsRtl();
      doc.save();
      doc.strokeColor(BORDER).lineWidth(0.35);
      for (let i = 1; i < 3; i++) {
        doc.moveTo(xs[i], top).lineTo(xs[i], top + h).stroke();
      }
      doc.restore();
    };

    const drawBlockedTableHeader = () => {
      const xs = blockedColXsRtl();
      const widths = [blockedColWDate, blockedColWStart, blockedColWEnd];
      doc.save();
      doc.rect(left, y, pageInnerW, headH).fill(TABLE_HEAD);
      doc.rect(left, y, pageInnerW, headH).strokeColor(BORDER).lineWidth(0.5).stroke();
      strokeBlockedColumnDividers(y, headH);
      doc.fillColor(INK);
      font(uiBold());
      doc.fontSize(10);
      for (let i = 0; i < 3; i++) {
        doc.text(rtlLabel(L.blockedCols[i]), xs[i] + cellPadX, y + 9, {
          width: widths[i] - cellPadX * 2,
          align: 'right',
          lineGap: 2,
          characterSpacing: 0.1,
        });
      }
      font(uiReg());
      doc.restore();
      y += headH;
    };

    const ensureSpaceForBlockedRow = () => {
      if (y + rowH + 2 <= bottomLimit()) return;
      doc.addPage();
      y = doc.page.margins.top;
      drawBlockedTableHeader();
    };

    if (report.blockedSlots.length === 0) {
      const emptyH = 90;
      ensureSpace(emptyH + 8);
      const emptyTop = y;
      doc.save();
      doc.rect(left, emptyTop, pageInnerW, emptyH).fill('#faf8f5');
      doc.dash(4, { space: 3 }).rect(left, emptyTop, pageInnerW, emptyH).strokeColor(BORDER).lineWidth(1).stroke();
      doc.undash();
      doc.restore();
      font(uiReg());
      doc.fontSize(11).fillColor(BODY_MUTED);
      doc.text(rtlLabel(L.blockedEmpty), left + 24, emptyTop + emptyH / 2 - 8, bodyTextOpts(pageInnerW - 48));
      doc.fillColor(INK);
      y = emptyTop + emptyH + 20;
    } else {
      ensureSpace(headH + rowH + 4);
      drawBlockedTableHeader();

      let blockedRowIdx = 0;
      for (const b of report.blockedSlots) {
        ensureSpaceForBlockedRow();
        const xs = blockedColXsRtl();
        const widths = [blockedColWDate, blockedColWStart, blockedColWEnd];
        if (blockedRowIdx % 2 === 1) {
          doc.save();
          doc.rect(left, y, pageInnerW, rowH).fill(ROW_ALT);
          doc.restore();
        }
        doc.save();
        doc.rect(left, y, pageInnerW, rowH).strokeColor(BORDER).lineWidth(0.35).stroke();
        strokeBlockedColumnDividers(y, rowH);
        doc.fillColor(SOFT_INK);
        doc.fontSize(9.5);
        const rawCells: [string, string, string] = [
          ltrText(lang === 'he' ? formatDateForHebrewReport(b.date) : formatReportDateYmd(b.date, lang)),
          ltrText(formatReportTimeHm(b.startTime, lang)),
          ltrText(formatReportTimeHm(b.endTime, lang)),
        ];
        for (let i = 0; i < 3; i++) {
          font(pickCellFont(rawCells[i]));
          doc.fillColor(SOFT_INK);
          doc.text(rawCells[i], xs[i] + cellPadX, y + 9, {
            width: widths[i] - cellPadX * 2,
            align: 'right',
            lineGap: 2,
          });
        }
        font(uiReg());
        doc.restore();
        y += rowH;
        blockedRowIdx += 1;
      }
    }

    // Persistent footer (rule + generated-by note + page number) on every page.
    const footerNote = lang === 'ar' ? 'تم الإصدار تلقائياً بواسطة نظام الإدارة' : 'הופק אוטומטית על ידי מערכת הניהול';
    const pageWord = lang === 'ar' ? 'صفحة' : 'עמוד';
    const ofWord = lang === 'ar' ? 'من' : 'מתוך';
    const pageRange = doc.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
      doc.switchToPage(i);
      // Drawing below the normal content area trips PDFKit's auto-pagination guard
      // (it treats any doc.text() past `page.height - margins.bottom` as overflow and
      // silently appends a new page). Zeroing the bottom margin for this one write
      // disables that guard without affecting the page's actual geometry.
      const originalBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - originalBottomMargin + 14;
      doc.save();
      doc.strokeColor(BORDER).lineWidth(0.5).moveTo(left, footerY).lineTo(left + pageInnerW, footerY).stroke();
      doc.restore();
      font(uiReg());
      doc.fontSize(8.5).fillColor(BODY_MUTED);
      doc.text(heNbsp(footerNote), left, footerY + 8, { width: pageInnerW / 2, align: 'left', lineBreak: false });
      drawBidiLine(
        [pageWord, String(i - pageRange.start + 1), ofWord, String(pageRange.count)],
        left + pageInnerW / 2,
        footerY + 8,
        pageInnerW / 2,
      );
      doc.fillColor(INK);
      doc.page.margins.bottom = originalBottomMargin;
    }

    doc.end();
    return new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  }

  async buildPdfBuffer(
    staffId: string,
    fromRaw?: string,
    toRaw?: string,
    langRaw?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const lang = normalizePdfLang(langRaw);
    const report = await this.buildReport(staffId, fromRaw, toRaw, { clientPlaceholderLang: lang });
    const buffer = await this.renderPdf(report, lang);
    const filename = `staff-report-${report.from}-${report.to}.pdf`;
    return { buffer, filename };
  }
}

@Controller('admin')
export class StaffReportsController {
  constructor(private readonly service: StaffReportsService) {}

  @Get('staff/:staffId/report')
  @UseGuards(...ADMIN_GUARDS)
  adminStaffReport(@Param('staffId') staffId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.buildReport(staffId.trim(), from, to);
  }

  @Get('staff/:staffId/report.pdf')
  @UseGuards(...ADMIN_GUARDS)
  async adminStaffReportPdf(
    @Param('staffId') staffId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('lang') lang?: string,
  ) {
    const { buffer, filename } = await this.service.buildPdfBuffer(staffId.trim(), from, to, lang);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('my-staff-report')
  @UseGuards(TokenAuthGuard, StaffGuard)
  myStaffReport(@RequestUser() user: { staffId?: string }, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.buildReport(user.staffId!, from, to);
  }

  @Get('my-staff-report.pdf')
  @UseGuards(TokenAuthGuard, StaffGuard)
  async myStaffReportPdf(
    @RequestUser() user: { staffId?: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('lang') lang?: string,
  ) {
    const { buffer, filename } = await this.service.buildPdfBuffer(user.staffId!, from, to, lang);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}

@Module({
  imports: [AuthModule],
  controllers: [StaffReportsController],
  providers: [StaffReportsService],
})
export class StaffReportsModule {}
