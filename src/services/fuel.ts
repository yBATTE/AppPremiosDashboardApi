// src/services/fuel.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import axios, { AxiosInstance } from "axios";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";

// =======================
// Tipos (shape backend)
// =======================
type LiquidsBlock = {
  total: { volume: number; amount: number };
  byProduct: Array<{ product: string; volume: number; amount: number }>;
};

type GncBlock = { volume: number; amount: number };

export type SalesDayOneStationResponse = {
  stationId: string;
  stationName: string;
  date: { year: number; month: number; day: number };
  day: { liquids: LiquidsBlock; gnc: GncBlock };
  mtd: { liquids: LiquidsBlock; gnc: GncBlock };
  lastTransaction?: string | null;
};

export type SalesDayAllStationsResponse = {
  date: { year: number; month: number; day: number };
  stations: Array<
    | {
        stationId: string;
        stationName: string;
        day: { liquids: LiquidsBlock; gnc: GncBlock };
        mtd: { liquids: LiquidsBlock; gnc: GncBlock };
        lastTransaction?: string | null;
      }
    | {
        stationId: string;
        stationName: string;
        error: string;
      }
  >;
};

export type SalesMonthOneStationResponse = {
  stationId: string;
  stationName: string;
  month: { year: number; month: number; toDay: number };
  totals: {
    liquids: { volume: number; amount: number };
    gnc: { volume: number; amount: number };
  };
  days: Array<{
    day: number;
    liquids: LiquidsBlock;
    gnc: GncBlock;
  }>;
  lastTransaction?: string | null;
};

// ===== Entradas =====
type DayParamsOne = { stationId: string; year: number; month: number; day: number };
type DayParamsAll = { year: number; month: number; day: number };
type MonthParamsOne = { stationId: string; year: number; month: number; toDay: number };

// =======================
// Config + helpers
// =======================
const BASE_URL = process.env.CONSOLIDATION_BASE_URL || "https://www.consolidation.com.ar";
const TZ = process.env.CONSOLIDATION_TZ || "America/Argentina/Buenos_Aires";

const EMAIL = process.env.EMAIL_CONSOLIDATION || process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD_CONSOLIDATION || process.env.PASSWORD || "";

const TIMEOUT_MS = Number(process.env.CONSOLIDATION_TIMEOUT_MS || 30000);

// ===== Estaciones (mismo set que frontend) =====
const STATIONS = [
  { id: "31088", name: "Combustibles Canning" },
  { id: "31342", name: "Catania" },
  { id: "20", name: "Tobago 1" },
  { id: "9", name: "Tobago 2" },
  { id: "99", name: "Monteverde" },
  { id: "88", name: "Bettica" },
] as const;

function stationName(stationId: string) {
  return STATIONS.find((s) => s.id === stationId)?.name ?? stationId;
}

function ensureConfigured() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Consolidation deshabilitado: faltan EMAIL_CONSOLIDATION / PASSWORD_CONSOLIDATION en el .env");
  }
}

function emptyLiquids(): LiquidsBlock {
  return { total: { volume: 0, amount: 0 }, byProduct: [] };
}
function emptyGnc(): GncBlock {
  return { volume: 0, amount: 0 };
}

function mapFuelName(desc: any) {
  const d = String(desc || "").trim().toUpperCase();
  if (d === "RON 98") return "Infinia";
  if (d === "RON 95") return "Super";
  if (d === "DIESEL PPM") return "Infinia Diesel";
  if (d === "DIESEL") return "Diesel";
  return String(desc || "N/A").trim() || "N/A";
}

function lastDayOfMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate();
}

// =======================
// Cookie jar + axios client
// =======================
const jar = new CookieJar();

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT_MS,
  maxRedirects: 0,
  validateStatus: () => true,
  headers: {
    "User-Agent": "Mozilla/5.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

// inject cookies
http.interceptors.request.use(async (config) => {
  const absUrl = new URL(String(config.url || ""), String(config.baseURL || BASE_URL)).toString();
  const cookieStr = await jar.getCookieString(absUrl);
  if (cookieStr) {
    config.headers = config.headers || {};
    (config.headers as any).Cookie = cookieStr;
  }
  return config;
});

// store set-cookie
http.interceptors.response.use(async (res) => {
  const setCookies = (res.headers as any)?.["set-cookie"];
  if (Array.isArray(setCookies)) {
    const absUrl = new URL(String(res.config.url || ""), String(res.config.baseURL || BASE_URL)).toString();
    for (const c of setCookies) {
      try {
        await jar.setCookie(c, absUrl);
      } catch {
        // ignore
      }
    }
  }
  return res;
});

function isRedirectToLogin(res: any) {
  const loc = String(res?.headers?.location || "").toLowerCase();
  return res?.status === 302 && loc.includes("/account/login");
}

function parseLoginForm(html: string) {
  const $ = cheerio.load(html || "");
  const form =
    $('form[action*="/Account/Login"]').first().length
      ? $('form[action*="/Account/Login"]').first()
      : $("form").first();

  const action = form.attr("action") || "/Account/Login";

  const fields: Record<string, string> = {};
  form.find("input[name]").each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") || "";
    if (name) fields[name] = value;
  });

  const token = fields["__RequestVerificationToken"] || null;
  return { action, fields, token };
}

let loginInFlight: Promise<boolean> | null = null;

async function login(commerceIdForReturnUrl: string) {
  ensureConfigured();

  const returnUrl = `/commerce/index/${commerceIdForReturnUrl}`;
  const loginPageUrl = `/Account/Login?ReturnUrl=${encodeURIComponent(returnUrl)}`;

  const page = await http.get(loginPageUrl, { headers: { Referer: `${BASE_URL}/` } });
  if (page.status >= 400) throw new Error(`GET login page falló: ${page.status}`);

  const { action, fields, token } = parseLoginForm(String(page.data || ""));
  if (!token) throw new Error("No encontré __RequestVerificationToken en el form de login.");

  fields.Email = EMAIL;
  fields.Password = PASSWORD;
  if (!("RememberMe" in fields)) fields.RememberMe = "false";
  if (!("ReturnUrl" in fields)) fields.ReturnUrl = returnUrl;

  const body = new URLSearchParams(fields).toString();

  const res = await http.post(action, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE_URL}${loginPageUrl}`,
    },
  });

  if (isRedirectToLogin(res)) return false;
  if (res.status === 302 && !isRedirectToLogin(res)) return true;

  // fallback: validar entrando al returnUrl
  const v = await http.get(returnUrl, { headers: { Referer: `${BASE_URL}/` } });
  return !isRedirectToLogin(v) && v.status === 200;
}

async function ensureLoggedIn() {
  ensureConfigured();

  if (loginInFlight) return loginInFlight;

  const commerceForLogin = process.env.COMMERCE_ID || STATIONS[0].id;

  loginInFlight = (async () => {
    const ok = await login(String(commerceForLogin));
    loginInFlight = null;
    if (!ok) throw new Error("Login falló (credenciales o cambio de form).");
    return true;
  })();

  return loginInFlight;
}

async function warmupCommerce(commerceId: string) {
  await ensureLoggedIn();

  const res = await http.get(`/commerce/index/${commerceId}`, { headers: { Referer: `${BASE_URL}/` } });
  if (isRedirectToLogin(res)) {
    // sesión vencida => re-login y retry 1 vez
    await ensureLoggedIn();
    const res2 = await http.get(`/commerce/index/${commerceId}`, { headers: { Referer: `${BASE_URL}/` } });
    if (isRedirectToLogin(res2)) throw new Error("Sesión vencida (warmup redirigió a login).");
    if (res2.status >= 400) throw new Error(`Warmup falló: ${res2.status}`);
    return;
  }
  if (res.status >= 400) throw new Error(`Warmup falló: ${res.status}`);
}

async function getSalesRaw(p: { commerceId: string; year: number; month: number; day: number }) {
  await ensureLoggedIn();

  const doReq = async () => {
    const res = await http.get("/Commerce/GetSales", {
      params: {
        commerceID: String(p.commerceId),
        year: String(p.year),
        month: String(p.month),
        day: String(p.day),
      },
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE_URL}/commerce/index/${p.commerceId}`,
      },
    });

    if (isRedirectToLogin(res)) throw new Error("Sesión vencida (GetSales redirigió a login).");
    if (res.status === 401 || res.status === 403) throw new Error(`GetSales bloqueado: ${res.status}`);
    if (res.status >= 400) throw new Error(`GetSales falló: ${res.status}`);

    return res.data;
  };

  try {
    return await doReq();
  } catch (e: any) {
    // retry 1 vez si fue sesión
    if (String(e?.message || "").toLowerCase().includes("sesión")) {
      await ensureLoggedIn();
      return await doReq();
    }
    throw e;
  }
}

// =======================
// Parse helpers (/Date(...)/)
// =======================
function msFromDotNetDate(s: any) {
  const m = String(s || "").match(/\/Date\((\d+)\)\//);
  return m ? Number(m[1]) : null;
}

function ymdInTZ(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const out: any = {};
  for (const p of parts) {
    if (p.type === "year") out.year = Number(p.value);
    if (p.type === "month") out.month = Number(p.value);
    if (p.type === "day") out.day = Number(p.value);
  }
  return out as { year: number; month: number; day: number };
}

function n0(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// =======================
// Transform: Día (day + mtd)
// =======================
function buildLiquidsDayAndMtd(raw: any, year: number, month: number, day: number) {
  const list: any[] = Array.isArray(raw?.ListConsolidatedCommerceBranchLiquid)
    ? raw.ListConsolidatedCommerceBranchLiquid
    : [];

  const dayAgg = new Map<string, { volume: number; amount: number }>();
  const mtdAgg = new Map<string, { volume: number; amount: number }>();

  for (const r of list) {
    const ms = msFromDotNetDate(r.DATE);
    if (!ms) continue;

    const { year: yy, month: mm, day: dd } = ymdInTZ(new Date(ms));
    if (yy !== year || mm !== month) continue;

    const prod = mapFuelName(r.DescriptionItem || "N/A");
    const vol = n0(r.TotalVolume);
    const amt = n0(r.TotalAmount);

    if (dd <= day) {
      const prev = mtdAgg.get(prod) || { volume: 0, amount: 0 };
      prev.volume += vol;
      prev.amount += amt;
      mtdAgg.set(prod, prev);
    }
    if (dd === day) {
      const prev = dayAgg.get(prod) || { volume: 0, amount: 0 };
      prev.volume += vol;
      prev.amount += amt;
      dayAgg.set(prod, prev);
    }
  }

  const toBlock = (m: Map<string, { volume: number; amount: number }>): LiquidsBlock => {
    const byProduct = Array.from(m.entries())
      .map(([product, v]) => ({ product, volume: v.volume, amount: v.amount }))
      .sort((a, b) => b.volume - a.volume);

    const total = byProduct.reduce(
      (acc, r) => ({ volume: acc.volume + r.volume, amount: acc.amount + r.amount }),
      { volume: 0, amount: 0 }
    );

    return { total, byProduct };
  };

  return {
    day: toBlock(dayAgg),
    mtd: toBlock(mtdAgg),
  };
}

function buildGncDayAndMtd(raw: any, year: number, month: number, day: number) {
  const list: any[] = Array.isArray(raw?.ListConsolidatedCommerceBranchGNC)
    ? raw.ListConsolidatedCommerceBranchGNC
    : [];

  let dayVol = 0, dayAmt = 0;
  let mtdVol = 0, mtdAmt = 0;

  for (const r of list) {
    const ms = msFromDotNetDate(r.DATE);
    if (!ms) continue;

    const { year: yy, month: mm, day: dd } = ymdInTZ(new Date(ms));
    if (yy !== year || mm !== month) continue;

    const vol = n0(r.TotalVolume);
    const amt = n0(r.TotalAmount);

    if (dd <= day) { mtdVol += vol; mtdAmt += amt; }
    if (dd === day) { dayVol += vol; dayAmt += amt; }
  }

  return {
    day: { volume: dayVol, amount: dayAmt } as GncBlock,
    mtd: { volume: mtdVol, amount: mtdAmt } as GncBlock,
  };
}

function transformDayResponse(raw: any, p: { stationId: string; year: number; month: number; day: number }) {
  const liquids = buildLiquidsDayAndMtd(raw, p.year, p.month, p.day);
  const gnc = buildGncDayAndMtd(raw, p.year, p.month, p.day);

  return {
    stationId: p.stationId,
    stationName: stationName(p.stationId),
    date: { year: p.year, month: p.month, day: p.day },
    lastTransaction: raw?.CommerceBranchStatus?.LastTransaction ?? null,
    day: {
      liquids: liquids.day ?? emptyLiquids(),
      gnc: gnc.day ?? emptyGnc(),
    },
    mtd: {
      liquids: liquids.mtd ?? emptyLiquids(),
      gnc: gnc.mtd ?? emptyGnc(),
    },
  } satisfies SalesDayOneStationResponse;
}

// =======================
// Transform: MES (days 1..toDay + totals)
// =======================
function transformMonthResponse(raw: any, p: { stationId: string; year: number; month: number; toDay: number }) {
  const toDay = Math.max(1, Math.min(p.toDay, lastDayOfMonth(p.year, p.month)));

  // liquids day map: day -> Map(product)->{v,a}
  const liquidsList: any[] = Array.isArray(raw?.ListConsolidatedCommerceBranchLiquid)
    ? raw.ListConsolidatedCommerceBranchLiquid
    : [];

  const liqDayMap = new Map<number, Map<string, { volume: number; amount: number }>>();
  const liqTotalAgg = new Map<string, { volume: number; amount: number }>();

  for (const r of liquidsList) {
    const ms = msFromDotNetDate(r.DATE);
    if (!ms) continue;

    const { year: yy, month: mm, day: dd } = ymdInTZ(new Date(ms));
    if (yy !== p.year || mm !== p.month) continue;
    if (dd > toDay) continue;

    const prod = mapFuelName(r.DescriptionItem || "N/A");
    const vol = n0(r.TotalVolume);
    const amt = n0(r.TotalAmount);

    if (!liqDayMap.has(dd)) liqDayMap.set(dd, new Map());
    const prodMap = liqDayMap.get(dd)!;

    const prev = prodMap.get(prod) || { volume: 0, amount: 0 };
    prev.volume += vol;
    prev.amount += amt;
    prodMap.set(prod, prev);

    const prevT = liqTotalAgg.get(prod) || { volume: 0, amount: 0 };
    prevT.volume += vol;
    prevT.amount += amt;
    liqTotalAgg.set(prod, prevT);
  }

  const gncList: any[] = Array.isArray(raw?.ListConsolidatedCommerceBranchGNC)
    ? raw.ListConsolidatedCommerceBranchGNC
    : [];

  const gncDayMap = new Map<number, { volume: number; amount: number }>();
  let gncTotalVol = 0;
  let gncTotalAmt = 0;

  for (const r of gncList) {
    const ms = msFromDotNetDate(r.DATE);
    if (!ms) continue;

    const { year: yy, month: mm, day: dd } = ymdInTZ(new Date(ms));
    if (yy !== p.year || mm !== p.month) continue;
    if (dd > toDay) continue;

    const vol = n0(r.TotalVolume);
    const amt = n0(r.TotalAmount);

    const prev = gncDayMap.get(dd) || { volume: 0, amount: 0 };
    prev.volume += vol;
    prev.amount += amt;
    gncDayMap.set(dd, prev);

    gncTotalVol += vol;
    gncTotalAmt += amt;
  }

  const mapToLiquidsBlock = (prodMap?: Map<string, { volume: number; amount: number }>): LiquidsBlock => {
    if (!prodMap) return emptyLiquids();

    const byProduct = Array.from(prodMap.entries())
      .map(([product, v]) => ({ product, volume: v.volume, amount: v.amount }))
      .sort((a, b) => b.volume - a.volume);

    const total = byProduct.reduce(
      (acc, r) => ({ volume: acc.volume + r.volume, amount: acc.amount + r.amount }),
      { volume: 0, amount: 0 }
    );

    return { total, byProduct };
  };

  // days 1..toDay (si no hay data => 0)
  const days: SalesMonthOneStationResponse["days"] = [];
  for (let d = 1; d <= toDay; d++) {
    const liq = mapToLiquidsBlock(liqDayMap.get(d));
    const g = gncDayMap.get(d) || { volume: 0, amount: 0 };
    days.push({
      day: d,
      liquids: liq,
      gnc: { volume: g.volume, amount: g.amount },
    });
  }

  // totals liquids desde agg
  const liqTotalsBlock = mapToLiquidsBlock(liqTotalAgg);
  const totalLiquidsVol = liqTotalsBlock.total.volume;
  const totalLiquidsAmt = liqTotalsBlock.total.amount;

  return {
    stationId: p.stationId,
    stationName: stationName(p.stationId),
    month: { year: p.year, month: p.month, toDay },
    totals: {
      liquids: { volume: totalLiquidsVol, amount: totalLiquidsAmt },
      gnc: { volume: gncTotalVol, amount: gncTotalAmt },
    },
    days,
    lastTransaction: raw?.CommerceBranchStatus?.LastTransaction ?? null,
  } satisfies SalesMonthOneStationResponse;
}

// ===============================
// EXPORTS usados por routes/fuel.ts
// ===============================
export async function getSalesDayOneStation(p: DayParamsOne): Promise<SalesDayOneStationResponse> {
  ensureConfigured();
  await ensureLoggedIn();
  await warmupCommerce(p.stationId);

  const raw = await getSalesRaw({ commerceId: p.stationId, year: p.year, month: p.month, day: p.day });
  return transformDayResponse(raw, { stationId: p.stationId, year: p.year, month: p.month, day: p.day });
}

export async function getSalesDayAllStations(p: DayParamsAll): Promise<SalesDayAllStationsResponse> {
  ensureConfigured();
  await ensureLoggedIn();

  const out: SalesDayAllStationsResponse["stations"] = [];

  // secuencial (más estable con sesión/cookies)
  for (const st of STATIONS) {
    try {
      await warmupCommerce(st.id);
      const raw = await getSalesRaw({ commerceId: st.id, year: p.year, month: p.month, day: p.day });
      const one = transformDayResponse(raw, { stationId: st.id, year: p.year, month: p.month, day: p.day });

      out.push({
        stationId: one.stationId,
        stationName: one.stationName,
        day: one.day,
        mtd: one.mtd,
        lastTransaction: one.lastTransaction ?? null,
      });
    } catch (e: any) {
      out.push({
        stationId: st.id,
        stationName: st.name,
        error: e?.message || "Error desconocido",
      });
    }
  }

  return {
    date: { year: p.year, month: p.month, day: p.day },
    stations: out,
  };
}

export async function getSalesMonthOneStation(p: MonthParamsOne): Promise<SalesMonthOneStationResponse> {
  ensureConfigured();
  await ensureLoggedIn();
  await warmupCommerce(p.stationId);

  const dim = lastDayOfMonth(p.year, p.month);
  const toDay = Math.max(1, Math.min(p.toDay, dim));

  // OJO: GetSales devuelve el mes entero, pero le pasamos day=toDay como hacía el server.js viejo
  const raw = await getSalesRaw({ commerceId: p.stationId, year: p.year, month: p.month, day: toDay });
  return transformMonthResponse(raw, { stationId: p.stationId, year: p.year, month: p.month, toDay });
}