// src/routes/movements.ts
import { Router } from "express";
import { getExtractConn } from "../db/extractData";
import { OtherItemModel } from "../models/extract/OtherItem";
import { OtherItemHistoryModel } from "../models/extract/OtherItemHistory";

const router = Router();

const CAFE_CODES = /^\s*\((1062|1063|1064)\)\s*/i;

function cleanPrizeName(raw: string) {
  return String(raw ?? "").replace(/^\(\d+\)\s*/, "").trim();
}

// ---- Fechas ----

// Fecha a hora Argentina -> para mostrar (dd/MM/yyyy HH:mm:ss)
function formatArgentinaDate(
  d: Date | string | null | undefined
): string | null {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Parsea "YYYY-MM-DD" de los query params
function parseParamDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);

  const dt = new Date(Date.UTC(year, month, day, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

// Parsea la fecha de cada movimiento (tanto del mes actual como histórico)
// Soporta:
//   - Date real
//   - ISO string
//   - "dd/MM/yyyy HH:mm:ss"
function parseMovementDate(raw: any): Date | null {
  if (!raw) return null;

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Intento directo (ISO, etc.)
  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime())) return direct;

  // dd/MM/yyyy HH:mm:ss
  const m = s.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/
  );
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);
    const hour = m[4] ? Number(m[4]) : 0;
    const minute = m[5] ? Number(m[5]) : 0;
    const second = m[6] ? Number(m[6]) : 0;

    const dt = new Date(Date.UTC(year, month, day, hour, minute, second));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

// Extrae los items internos de otheritemhistories
// Asumo que tu doc es algo como { data: { items: [...] } } o { data: { rows: [...] } }
function collectHistoryItems(histDocs: any[]): any[] {
  const out: any[] = [];

  for (const h of histDocs) {
    const data = (h as any).data;

    let arr: any[] | undefined;
    if (Array.isArray(data)) {
      arr = data;
    } else if (Array.isArray(data?.items)) {
      arr = data.items;
    } else if (Array.isArray(data?.rows)) {
      arr = data.rows;
    } else if (Array.isArray(data?.movements)) {
      arr = data.movements;
    }

    if (!arr) continue;

    arr.forEach((item, idx) => {
      out.push({
        ...item,
        // id sintético si no trae _id
        _id: item._id || `history-${String(h._id)}-${idx}`,
        // scrapedAt para calcular lastUpdated
        scrapedAt:
          item.scrapedAt ?? h.scrapedAt ?? h.seenAt ?? h.expiresAt ?? null,
      });
    });
  }

  return out;
}

// ---- Ruta principal ----

router.get("/", async (req, res) => {
  try {
    const conn = await getExtractConn();
    const OtherItem = OtherItemModel(conn);
    const OtherItemHistory = OtherItemHistoryModel(conn);

    // 1) Movimientos del mes actual
    const currentDocs = await OtherItem.find().lean().exec();

    // 2) Movimientos históricos
    const historyDocs = await OtherItemHistory.find().lean().exec();
    const historyItems = collectHistoryItems(historyDocs);

    // 3) Juntamos todo
    const allDocs: any[] = [...currentDocs, ...historyItems];

    // Última fecha de actualización (scrapedAt más reciente)
    let lastUpdated: string | null = null;
    if (allDocs.length > 0) {
      let latest: Date | null = null;
      for (const d of allDocs) {
        const raw = d.scrapedAt;
        if (!raw) continue;
        const dt = new Date(raw);
        if (Number.isNaN(dt.getTime())) continue;
        if (!latest || dt > latest) latest = dt;
      }
      if (latest) lastUpdated = formatArgentinaDate(latest);
    }

    const { startDate, endDate } = req.query;

    let from: Date | null = null;
    let to: Date | null = null;

    from = parseParamDate(startDate);
    to = parseParamDate(endDate);
    if (to) {
      // incluir todo el día final
      to.setUTCHours(23, 59, 59, 999);
    }

    // 4) Filtro por rango de fechas usando d.fecha
    const filteredDocs = allDocs.filter((d: any) => {
      if (!from && !to) return true;

      const dDate = parseMovementDate(d.fecha);
      if (!dDate) {
        // si no podemos parsear la fecha, lo excluimos cuando hay filtro
        return false;
      }

      if (from && dDate < from) return false;
      if (to && dDate > to) return false;
      return true;
    });

    // 5) Mapear al formato del frontend
    const rows = filteredDocs.map((d: any) => {
      const movementRaw = String(d.movimiento ?? "").trim();
      const lower = movementRaw.toLowerCase();
      const isAdjustment = lower === "adjustment" || lower === "adjust";

      const isEgress = lower === "egress";
      const type = isAdjustment
        ? "AJUSTE"
        : isEgress
        ? "EGRESO"
        : "INGRESO";

      const locationName = isEgress
        ? String(d.depositoOrigen || d.depositoDestino || "").trim()
        : String(d.depositoDestino || d.depositoOrigen || "").trim();

      const rewardRaw = String(d.recompensa ?? "").trim();
      const isCafeCombo = CAFE_CODES.test(rewardRaw);

      // fecha para mostrar siempre en dd/MM/yyyy HH:mm:ss
      const formattedDate =
        formatArgentinaDate(d.fecha) ?? String(d.fecha ?? "");

      return {
        id: String(d._id),
        date: formattedDate, // lo que ve el front
        prizeName: cleanPrizeName(rewardRaw),
        locationName,
        type, // "INGRESO" / "EGRESO" / "AJUSTE"
        quantity: Number(d.cantidad ?? 0) || 0,
        entity: String(d.entidad ?? "").trim(),
        rewardRaw,
        isCafeCombo,
        movement: movementRaw, // "Adjustment", "Egress", etc.
        lastUpdated, // misma fecha para todas las filas
      };
    });

    res.json(rows);
  } catch (err: any) {
    console.error("GET /api/movements", err);
    res.status(500).json({
      message: "Error al obtener movimientos",
      error: err?.message || String(err),
    });
  }
});

export default router;
