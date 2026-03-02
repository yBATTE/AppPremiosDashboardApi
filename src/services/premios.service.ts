// src/services/premios.service.ts
import axios, { AxiosInstance } from "axios";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

export type PremiosPayload = {
  year: number;
  stations: string[];
  months: Array<{ month: string; values: Record<string, number> }>;
  monthsPoints: Array<{ month: string; values: Record<string, number> }>;
  monthsMoney: Array<{ month: string; values: Record<string, number> }>;
  meta: any;
  source: string;
  lastUpdated: string;
};

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

function norm(s: unknown) {
  return String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
}

function parseNumberAR(s: unknown) {
  let x = String(s || "").trim();
  if (!x) return 0;
  x = x.replace(/[^\d,.-]/g, "");
  if (x.includes(".") && x.includes(",")) x = x.replace(/\./g, "").replace(",", ".");
  else x = x.replace(",", ".");
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function safeNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractRewardCode(text: unknown) {
  const m = /\((\d+)\)/.exec(String(text || ""));
  return m ? Number(m[1]) : null;
}

function stripDiacritics(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeRewardKey(s: unknown) {
  let t = String(s || "").trim();
  t = t.replace(/^\(\d+\)\s*/g, "");
  t = stripDiacritics(t).toUpperCase();
  t = t.replace(/[^A-Z0-9]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function normalizeEntidadAGR(entidad: unknown) {
  const e = norm(entidad);
  if (e.includes("MONTEVERDE")) return "Monteverde";
  if (e.includes("BETTICA")) return "Bettica";
  if (e.includes("TOBAGO") && e.includes("1")) return "Tobago 1";
  if (e === "TOBAGO") return "Tobago 1";
  return String(entidad || "").trim() || "SIN ESTACION";
}

// Ignorados (igual que tu server.js viejo)
const PREMIOS_IGNORE = [
  "(1064) GASEOSA + ALFAJOR",
  "(1062) CAFE + FACTURA O ALFAJOR",
  "(1063) CANJE CAFE + ALFAJOR",
  "(1062) CAFE CHICO PARA LLEVAR + 2 FACTURAS",
].map((s) => norm(s));

const PREMIOS_IGNORE_CODES = new Set<number>(
  PREMIOS_IGNORE.map((s) => (/\((\d+)\)/.exec(s)?.[1] ? Number(/\((\d+)\)/.exec(s)![1]) : null)).filter(Boolean) as number[],
);

export class PremiosService {
  private AGR_BASE = "https://adm.agrcloud.com.ar";
  private AGR_SERVICE_ID = Number(process.env.AGR_SERVICE_ID || 2);
  private AGR_ITEMS_CATEGORY_ID = Number(process.env.AGR_ITEMS_CATEGORY_ID || 2);
  private PESOS_PER_POINT = Number(process.env.PESOS_PER_POINT || 23.97);

  private AGR_COOKIE = process.env.AGR_COOKIE || "";
  private AGR_USER = process.env.AGR_USER || "";
  private AGR_PASS = process.env.AGR_PASS || "";

  private AGR_PAGE_SIZE = Number(process.env.AGR_PAGE_SIZE || 20);

  private DATA_DIR = (process.env.PREMIOS_DATA_DIR || path.join(process.cwd(), "data")).trim();

  private PREMIOS_STATIONS_ORDER = (process.env.PREMIOS_STATIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  private agrJar = new CookieJar();
  private agrHttp: AxiosInstance;

  private agrLoginInFlight: Promise<boolean> | null = null;

  constructor() {
    this.agrHttp = axios.create({
      baseURL: this.AGR_BASE,
      timeout: 30_000,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    // inject cookies
    this.agrHttp.interceptors.request.use(async (config) => {
      const base = config.baseURL || this.AGR_BASE;
      const url = config.url || "/";
      const absUrl = new URL(url, base).toString();
      const cookieStr = await this.agrJar.getCookieString(absUrl);
      if (cookieStr) {
        config.headers = config.headers || {};
        (config.headers as any).Cookie = cookieStr;
      }
      return config;
    });

    // persist set-cookie
    this.agrHttp.interceptors.response.use(async (res) => {
      const setCookies = (res.headers as any)?.["set-cookie"];
      if (Array.isArray(setCookies)) {
        const base = res.config.baseURL || this.AGR_BASE;
        const url = res.config.url || "/";
        const absUrl = new URL(url, base).toString();
        for (const c of setCookies) {
          try {
            await this.agrJar.setCookie(c, absUrl);
          } catch {}
        }
      }
      return res;
    });
  }

  // ---------------------------
  // Cache helpers
  // ---------------------------
  private async ensureDir() {
    if (!fs.existsSync(this.DATA_DIR)) {
      await fsp.mkdir(this.DATA_DIR, { recursive: true });
    }
  }

  private cachePath(year: number) {
    return path.join(this.DATA_DIR, `premios-cache-${year}.json`);
  }

  private async readCache(year: number): Promise<PremiosPayload | null> {
    try {
      const raw = await fsp.readFile(this.cachePath(year), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private async writeCache(year: number, data: PremiosPayload) {
    await this.ensureDir();
    await fsp.writeFile(this.cachePath(year), JSON.stringify(data, null, 2), "utf8");
  }

  private itemsCachePath() {
    return path.join(this.DATA_DIR, `premios-items-${this.AGR_ITEMS_CATEGORY_ID}.json`);
  }

  private async readItemsCache(): Promise<any | null> {
    try {
      const raw = await fsp.readFile(this.itemsCachePath(), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private async writeItemsCache(data: any) {
    await this.ensureDir();
    await fsp.writeFile(this.itemsCachePath(), JSON.stringify(data, null, 2), "utf8");
  }

  // ---------------------------
  // AGR login
  // ---------------------------
  private agrLooksLikeLogin(html: unknown) {
    const t = String(html || "");
    return t.includes("/Account/SignIn") || (t.includes("input") && t.toLowerCase().includes("password"));
  }

  private agrIsRedirectToLogin(res: any) {
    const loc = String(res?.headers?.location || "").toLowerCase();
    return res?.status === 302 && loc.includes("/account/signin");
  }

  private async seedAgrCookieHeader(cookieHeader: string) {
    const parts = String(cookieHeader || "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);

    await Promise.all(
      parts.map(async (p) => {
        const eq = p.indexOf("=");
        if (eq === -1) return;
        const name = p.slice(0, eq).trim();
        const value = p.slice(eq + 1).trim();
        if (!name) return;
        const setCookieLine = `${name}=${value}; Domain=adm.agrcloud.com.ar; Path=/`;
        try {
          await this.agrJar.setCookie(setCookieLine, this.AGR_BASE);
        } catch {}
      }),
    );
  }

  private parseAgrLoginForm(html: string) {
    const $ = cheerio.load(html);
    const form = $("form").first();
    const action = form.attr("action") || "/Account/SignIn";

    const fields: Record<string, string> = {};
    form.find("input").each((_, el) => {
      const key = $(el).attr("name") || $(el).attr("id");
      if (!key) return;
      fields[key] = $(el).attr("value") || "";
    });

    return { action, fields };
  }

  private async agrLogin(): Promise<boolean> {
    if (this.agrLoginInFlight) return this.agrLoginInFlight;

    this.agrLoginInFlight = (async () => {
      // 1) si hay cookie ya seteada
      if (this.AGR_COOKIE) {
        await this.seedAgrCookieHeader(this.AGR_COOKIE);
        return true;
      }

      if (!this.AGR_USER || !this.AGR_PASS) {
        throw new Error("Falta AGR_USER/AGR_PASS en .env");
      }

      const loginUrl = "/Account/SignIn?ReturnUrl=%2FError%2F404";

      const loginPage = await this.agrHttp.get(loginUrl, {
        headers: { Referer: `${this.AGR_BASE}/` },
      });

      if (loginPage.status >= 400) {
        throw new Error(`GET login AGR falló: ${loginPage.status}`);
      }

      const { action, fields } = this.parseAgrLoginForm(String(loginPage.data || ""));

      if ("Username" in fields) fields.Username = this.AGR_USER;
      else if ("UserName" in fields) fields.UserName = this.AGR_USER;
      else if ("Email" in fields) fields.Email = this.AGR_USER;
      else fields.Username = this.AGR_USER;

      if ("Password" in fields) fields.Password = this.AGR_PASS;
      else fields.Password = this.AGR_PASS;

      if (!("ReturnUrl" in fields)) fields.ReturnUrl = "/Error/404";

      const body = new URLSearchParams(fields).toString();

      const res = await this.agrHttp.post(action, body, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: `${this.AGR_BASE}${loginUrl}`,
        },
      });

      // seguir redirect si existe
      if (res.status === 302 && res.headers?.location) {
        const loc = res.headers.location.startsWith("http") ? res.headers.location : `${this.AGR_BASE}${res.headers.location}`;
        await this.agrHttp.get(loc, { headers: { Referer: `${this.AGR_BASE}${loginUrl}` } });
      }

      // test: movimientos
      const test = await this.agrHttp.get(`/filtered/items/movements/details/service/${this.AGR_SERVICE_ID}`, {
        params: {
          startDate: "2026-02-01",
          endDate: "2026-02-01T23:59:59",
          orderBy: "date-desc",
          page: 1,
          pageSize: 1,
        },
        headers: { Referer: `${this.AGR_BASE}/filtered/items/movements/details/service/${this.AGR_SERVICE_ID}` },
      });

      if (this.agrIsRedirectToLogin(test) || this.agrLooksLikeLogin(test.data)) {
        throw new Error("Login AGR falló: sigue devolviendo SignIn.");
      }

      return true;
    })();

    try {
      return await this.agrLoginInFlight;
    } finally {
      this.agrLoginInFlight = null;
    }
  }

  // ---------------------------
  // Movements (canjes)
  // ---------------------------
  private async agrGetMovementsPage(args: { startDate: string; endDate: string; page: number; pageSize: number }) {
    await this.agrLogin();

    const res = await this.agrHttp.get(`/filtered/items/movements/details/service/${this.AGR_SERVICE_ID}`, {
      params: { startDate: args.startDate, endDate: args.endDate, orderBy: "date-desc", page: args.page, pageSize: args.pageSize },
      headers: { Referer: `${this.AGR_BASE}/filtered/items/movements/details/service/${this.AGR_SERVICE_ID}` },
    });

    // si se fue a login: re-login y reintentar
    if (this.agrIsRedirectToLogin(res) || this.agrLooksLikeLogin(res.data)) {
      await this.agrLogin();
      const res2 = await this.agrHttp.get(`/filtered/items/movements/details/service/${this.AGR_SERVICE_ID}`, {
        params: { startDate: args.startDate, endDate: args.endDate, orderBy: "date-desc", page: args.page, pageSize: args.pageSize },
        headers: { Referer: `${this.AGR_BASE}/filtered/items/movements/details/service/${this.AGR_SERVICE_ID}` },
      });
      return res2;
    }

    return res;
  }

  private parseMovementsHtml(html: string) {
    const $ = cheerio.load(html);

    const table = $("table").first();
    const rows: Array<{ entidad: string; movimiento: string; documento: string; recompensa: string; cantidad: number }> = [];

    if (!table.length) return { rows, totalItems: null as number | null };

    table.find("tbody tr").each((_, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 8) return;

      const entidad = $(tds[1]).text().trim();
      const movimiento = $(tds[2]).text().trim();
      const documento = $(tds[3]).text().trim();
      const recompensa = $(tds[4]).text().trim();
      const cantidadRaw = $(tds[7]).text().trim();

      const cantidad = Number(String(cantidadRaw).replace(".", "").replace(",", "."));
      rows.push({
        entidad,
        movimiento,
        documento,
        recompensa,
        cantidad: Number.isFinite(cantidad) ? cantidad : 0,
      });
    });

    const bodyText = $("body").text().replace(/\s+/g, " ");
    const m = /items de\s+(\d+)/i.exec(bodyText);
    const totalItems = m ? Number(m[1]) : null;

    return { rows, totalItems };
  }

  private premiosMonthRange(year: number, month1to12: number) {
    const now = new Date();
    const y = Number(year);
    const m = Number(month1to12);

    const mm = String(m).padStart(2, "0");
    const startDate = `${y}-${mm}-01`;

    const isCurrent = now.getFullYear() === y && now.getMonth() + 1 === m;
    const endDay = isCurrent ? now.getDate() : new Date(y, m, 0).getDate();

    const endDate = `${y}-${mm}-${String(endDay).padStart(2, "0")}T23:59:59`;
    return { startDate, endDate };
  }

  private async agrFetchAllRowsForRange(args: { startDate: string; endDate: string }) {
    const pageSize = this.AGR_PAGE_SIZE;
    let page = 1;
    let totalPages: number | null = null;
    let out: any[] = [];

    while (true) {
      const res = await this.agrGetMovementsPage({ startDate: args.startDate, endDate: args.endDate, page, pageSize });

      if (res.status >= 400) {
        throw new Error(`AGR movements HTTP ${res.status}`);
      }

      const { rows, totalItems } = this.parseMovementsHtml(String(res.data || ""));
      if (totalItems !== null && totalPages === null) totalPages = Math.ceil(totalItems / pageSize);

      if (!rows.length) break;
      out = out.concat(rows);

      if (totalPages !== null && page >= totalPages) break;

      page += 1;
      if (page > 5000) break;
    }

    return out;
  }

  // ---------------------------
  // Items (points map)
  // ---------------------------
  private async agrGetItemsPage(args: { page: number; pageSize: number }) {
    await this.agrLogin();

    const res = await this.agrHttp.get(`/filtered/items/${this.AGR_ITEMS_CATEGORY_ID}`, {
      params: {
        minCost: "0.00",
        maxCost: "100000.00",
        minPoints: "0.00",
        maxPoints: "100000.00",
        page: args.page,
        pageSize: args.pageSize,
      },
      headers: { Referer: `${this.AGR_BASE}/filtered/items/${this.AGR_ITEMS_CATEGORY_ID}` },
    });

    return res;
  }

  private parseItemsPointsHtml(html: string) {
    const $ = cheerio.load(html);

    let table: any = null;
    $("table").each((_, t) => {
      const head = $(t).find("thead").text();
      if (norm(head).includes("PUNTO")) {
        table = $(t);
        return false;
      }
    });
    if (!table || !table.length) table = $("table").first();
    if (!table.length) return { byName: {} as Record<string, number>, byCode: {} as Record<string, number>, totalItems: null as number | null };

    const headers: string[] = [];
    table.find("thead th").each((_: any, th: any) => headers.push(norm($(th).text())));

    const idxPoints = headers.findIndex((h) => h.includes("PUNTO"));
    let idxName = headers.findIndex((h) => h.includes("NOMBRE") || h.includes("ITEM") || h.includes("RECOMPENSA") || h.includes("DESCRIP"));
    if (idxName === -1) idxName = 0;

    const byName: Record<string, number> = {};
    const byCode: Record<string, number> = {};

    table.find("tbody tr").each((_: any, tr: any) => {
      const tds = $(tr).find("td");
      if (!tds.length) return;

      const nameRaw = $(tds[idxName]).text().trim();
      if (!nameRaw) return;

      const code = extractRewardCode(nameRaw) || extractRewardCode($(tr).text());
      const key = normalizeRewardKey(nameRaw);

      let points = 0;
      if (idxPoints >= 0 && idxPoints < tds.length) points = parseNumberAR($(tds[idxPoints]).text().trim());
      else points = parseNumberAR($(tr).text());

      byName[key] = points;
      if (code) byCode[String(code)] = points;
    });

    const bodyText = $("body").text().replace(/\s+/g, " ");
    const m = /items de\s+(\d+)/i.exec(bodyText);
    const totalItems = m ? Number(m[1]) : null;

    return { byName, byCode, totalItems };
  }

  private async getPointsMap(args: { force?: boolean } = {}) {
    const force = !!args.force;

    const cached = await this.readItemsCache();
    const TTL_MS = 24 * 60 * 60 * 1000;
    const isFresh = cached?.lastUpdated && Date.now() - new Date(cached.lastUpdated).getTime() < TTL_MS;

    if (!force && cached?.maps && isFresh) {
      return {
        maps: cached.maps,
        itemsLastUpdated: cached.lastUpdated,
        itemsCount: cached.itemsCount || Object.keys(cached.maps?.byName || {}).length,
      };
    }

    const pageSize = this.AGR_PAGE_SIZE;
    let page = 1;
    let totalPages: number | null = null;

    const byName: Record<string, number> = {};
    const byCode: Record<string, number> = {};

    while (true) {
      const res = await this.agrGetItemsPage({ page, pageSize });
      if (res.status >= 400) throw new Error(`AGR items HTTP ${res.status}`);

      const parsed = this.parseItemsPointsHtml(String(res.data || ""));
      Object.assign(byName, parsed.byName || {});
      Object.assign(byCode, parsed.byCode || {});

      if (parsed.totalItems !== null && totalPages === null) totalPages = Math.ceil(parsed.totalItems / pageSize);
      if (totalPages !== null && page >= totalPages) break;

      page += 1;
      if (page > 5000) break;
    }

    const payload = {
      lastUpdated: new Date().toISOString(),
      itemsCount: Object.keys(byName).length,
      maps: { byName, byCode },
    };

    await this.writeItemsCache(payload);

    return {
      maps: payload.maps,
      itemsLastUpdated: payload.lastUpdated,
      itemsCount: payload.itemsCount,
    };
  }

  // ---------------------------
  // Aggregate
  // ---------------------------
  private aggregatePremios(rows: any[], pointsMaps: { byName: Record<string, number>; byCode: Record<string, number> }) {
    const countsByStation: Record<string, number> = {};
    const pointsByStation: Record<string, number> = {};
    const moneyByStation: Record<string, number> = {};

    let matchedByCode = 0;
    let matchedByName = 0;
    let unmatched = 0;

    const unknownSet = new Set<string>();

    for (const r of rows) {
      if (norm(r.movimiento) !== "EGRESO") continue;
      if (!/recibo de canje/i.test(r.documento || "")) continue;

      const combined = norm(`${r.documento} ${r.recompensa}`);
      if (PREMIOS_IGNORE.some((x) => combined.includes(x))) continue;

      const code = extractRewardCode(r.recompensa) || extractRewardCode(combined);
      if (code && PREMIOS_IGNORE_CODES.has(code)) continue;

      const st = normalizeEntidadAGR(r.entidad);
      const qty = Number.isFinite(r.cantidad) ? r.cantidad : 0;

      countsByStation[st] = (countsByStation[st] || 0) + qty;

      const key = normalizeRewardKey(r.recompensa);

      let itemPoints = 0;
      if (code && pointsMaps?.byCode?.[String(code)] != null) {
        itemPoints = Number(pointsMaps.byCode[String(code)] || 0);
        matchedByCode += 1;
      } else if (pointsMaps?.byName?.[key] != null) {
        itemPoints = Number(pointsMaps.byName[key] || 0);
        matchedByName += 1;
      } else {
        unmatched += 1;
        if (unknownSet.size < 30) unknownSet.add(key);
      }

      const totalPoints = qty * itemPoints;
      const totalMoney = totalPoints * this.PESOS_PER_POINT;

      pointsByStation[st] = (pointsByStation[st] || 0) + totalPoints;
      moneyByStation[st] = (moneyByStation[st] || 0) + totalMoney;
    }

    return {
      countsByStation,
      pointsByStation,
      moneyByStation,
      stats: { matchedByCode, matchedByName, unmatched },
      unknownRewardsSample: Array.from(unknownSet),
    };
  }

  private normalizePremiosPayload(args: {
    year: number;
    stations: string[];
    months: any[];
    monthsPoints: any[];
    monthsMoney: any[];
    meta: any;
  }): PremiosPayload {
    const monthMap = new Map<string, any>();
    for (const m of args.months || []) monthMap.set(m.month, m.values || {});
    const fullMonths = MONTHS.map((mm) => ({ month: mm, values: monthMap.get(mm) || {} }));

    const monthMapP = new Map<string, any>();
    for (const m of args.monthsPoints || []) monthMapP.set(m.month, m.values || {});
    const fullMonthsPoints = MONTHS.map((mm) => ({ month: mm, values: monthMapP.get(mm) || {} }));

    const monthMapM = new Map<string, any>();
    for (const m of args.monthsMoney || []) monthMapM.set(m.month, m.values || {});
    const fullMonthsMoney = MONTHS.map((mm) => ({ month: mm, values: monthMapM.get(mm) || {} }));

    return {
      year: Number(args.year),
      stations: Array.isArray(args.stations) ? args.stations : [],
      months: fullMonths,
      monthsPoints: fullMonthsPoints,
      monthsMoney: fullMonthsMoney,
      meta: args.meta || { pesosPerPoint: this.PESOS_PER_POINT, pointUnit: "m³ GNC" },
      source: "agrcloud-html",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async buildPremiosFromAGR(year: number, opts: { useCacheSkipClosedMonths: boolean; forcePoints: boolean }) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const cached = await this.readCache(year);

    const pointsRes = await this.getPointsMap({ force: opts.forcePoints });
    const pointsMaps = pointsRes.maps;

    const maxMonth = year < currentYear ? 12 : year === currentYear ? currentMonth : 12;

    const months: any[] = [];
    const monthsPoints: any[] = [];
    const monthsMoney: any[] = [];
    const stationSet = new Set<string>();

    const matchStats = { matchedByCode: 0, matchedByName: 0, unmatched: 0 };
    const unknownRewards = new Set<string>();

    for (let m = 1; m <= maxMonth; m++) {
      const monthKey = MONTHS[m - 1];

      const isClosed =
        year < currentYear ? true :
        year === currentYear ? m < currentMonth :
        false;

      // ✅ si está cerrado y cacheado completo, reutiliza (solo si useCacheSkipClosedMonths=true)
      if (opts.useCacheSkipClosedMonths && isClosed && cached?.months && cached?.monthsPoints && cached?.monthsMoney) {
        const c1 = (cached.months || []).find((x: any) => x.month === monthKey);
        const c2 = (cached.monthsPoints || []).find((x: any) => x.month === monthKey);
        const c3 = (cached.monthsMoney || []).find((x: any) => x.month === monthKey);

        if (c1 && c2 && c3) {
          months.push({ month: monthKey, values: c1.values || {} });
          monthsPoints.push({ month: monthKey, values: c2.values || {} });
          monthsMoney.push({ month: monthKey, values: c3.values || {} });

          Object.keys(c1.values || {}).forEach((s) => stationSet.add(s));
          Object.keys(c2.values || {}).forEach((s) => stationSet.add(s));
          Object.keys(c3.values || {}).forEach((s) => stationSet.add(s));
          continue;
        }
      }

      const { startDate, endDate } = this.premiosMonthRange(year, m);
      const rows = await this.agrFetchAllRowsForRange({ startDate, endDate });

      const agg = this.aggregatePremios(rows, pointsMaps);

      matchStats.matchedByCode += agg.stats.matchedByCode;
      matchStats.matchedByName += agg.stats.matchedByName;
      matchStats.unmatched += agg.stats.unmatched;
      agg.unknownRewardsSample.forEach((x) => unknownRewards.add(x));

      Object.keys(agg.countsByStation).forEach((s) => stationSet.add(s));
      Object.keys(agg.pointsByStation).forEach((s) => stationSet.add(s));
      Object.keys(agg.moneyByStation).forEach((s) => stationSet.add(s));

      months.push({ month: monthKey, values: agg.countsByStation });
      monthsPoints.push({ month: monthKey, values: agg.pointsByStation });
      monthsMoney.push({ month: monthKey, values: agg.moneyByStation });
    }

    let stations = Array.from(stationSet);

    if (this.PREMIOS_STATIONS_ORDER.length) {
      const rest = stations.filter((s) => !this.PREMIOS_STATIONS_ORDER.includes(s)).sort();
      stations = [...this.PREMIOS_STATIONS_ORDER.filter((s) => stationSet.has(s)), ...rest];
    } else {
      stations.sort();
    }

    return this.normalizePremiosPayload({
      year,
      stations,
      months,
      monthsPoints,
      monthsMoney,
      meta: {
        pesosPerPoint: this.PESOS_PER_POINT,
        pointUnit: "m³ GNC",
        itemsLastUpdated: pointsRes.itemsLastUpdated,
        itemsCount: pointsRes.itemsCount,
        itemsUrl: `${this.AGR_BASE}/filtered/items/${this.AGR_ITEMS_CATEGORY_ID}`,
        matchStats,
        unknownRewardsSample: Array.from(unknownRewards).slice(0, 30),
      },
    });
  }

  // ===========================
  // PUBLIC API (para routes)
  // ===========================
  async getPremios(year: number, opts: { force?: boolean; forcePoints?: boolean } = {}) {
    const force = !!opts.force;
    const forcePoints = !!opts.forcePoints;

    const cached = await this.readCache(year);

    const TTL_MS = 30 * 60 * 1000;
    const isFresh = cached?.lastUpdated && Date.now() - new Date(cached.lastUpdated).getTime() < TTL_MS;

    if (!force && cached && isFresh) return cached;

    // ✅ si force=1 -> recalcula todo (incluye ENE)
    const skipClosed = !force;
    const fresh = await this.buildPremiosFromAGR(year, { useCacheSkipClosedMonths: skipClosed, forcePoints });

    await this.writeCache(year, fresh);
    return fresh;
  }

  async refreshPremios(year: number, opts: { forcePoints?: boolean } = {}) {
    const forcePoints = !!opts.forcePoints;

    // ✅ refresh siempre recalcula TODO
    const fresh = await this.buildPremiosFromAGR(year, { useCacheSkipClosedMonths: false, forcePoints });
    await this.writeCache(year, fresh);

    return { ok: true, year, lastUpdated: fresh.lastUpdated, source: fresh.source };
  }
}