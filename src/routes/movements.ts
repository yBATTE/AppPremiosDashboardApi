// src/routes/movements.ts
import { Router } from "express";
import { getExtractConn } from "../db/extractData";
import { OtherItemModel } from "../models/extract/OtherItem";

const router = Router();

const CAFE_CODES = /^\s*\((1062|1063|1064)\)\s*/i;

function cleanPrizeName(raw: string) {
  return String(raw ?? "").replace(/^\(\d+\)\s*/, "").trim();
}

// ---------- Helpers de fechas ----------

// Parsea "dd/MM/yyyy" -> Date (a las 00:00)
function parseDdMmYyyy(str: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1; // 0-11
  const year = Number(m[3]);
  const d = new Date(year, month, day, 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Parsea "dd/MM/yyyy HH:mm:ss" o ISO -> Date
function parseMovementDate(raw: any): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // dd/MM/yyyy HH:mm:ss
  const m =
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const ss = Number(m[6]);
    const d = new Date(year, month, day, hh, mm, ss, 0);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // fallback: ISO u otros formatos que entienda JS
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Fecha a hora Argentina para el "Actualizado: ..."
function formatArgentinaDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date =
    d instanceof Date ? d : parseMovementDate(d);
  if (!date) return null;

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

router.get("/", async (req, res) => {
  try {
    const conn = await getExtractConn();
    const OtherItem = OtherItemModel(conn);

    // TODO: si querés incluir históricos, acá habría que
    // leer también la colección otheritemhistories y unir ambos arrays.

    const docs = await OtherItem.find().lean().exec();

    // Última fecha de actualización (scrapedAt más reciente)
    let lastUpdated: string | null = null;
    if (docs.length > 0) {
      let latest: Date | null = null;
      for (const d of docs as any[]) {
        const raw = d.scrapedAt;
        if (!raw) continue;
        const dt = parseMovementDate(raw);
        if (!dt) continue;
        if (!latest || dt > latest) latest = dt;
      }
      if (latest) lastUpdated = formatArgentinaDate(latest);
    }

    const { startDate, endDate } = req.query;

    let from: Date | null = null;
    let to: Date | null = null;

    if (typeof startDate === "string" && startDate.trim()) {
      // Esperamos "dd/MM/yyyy"
      from = parseDdMmYyyy(startDate);
    }
    if (typeof endDate === "string" && endDate.trim()) {
      to = parseDdMmYyyy(endDate);
      if (to) {
        // incluir todo el día final
        to.setHours(23, 59, 59, 999);
      }
    }

    const filteredDocs = docs.filter((d: any) => {
      if (!from && !to) return true;

      const dDate = parseMovementDate(d.fecha);
      if (!dDate) {
        // si no podemos parsear fecha y hay filtro, lo excluimos
        return false;
      }

      if (from && dDate < from) return false;
      if (to && dDate > to) return false;
      return true;
    });

    const rows = filteredDocs.map((d: any) => {
      const movementRaw = String(d.movimiento ?? "").trim();
      const isEgress = movementRaw.toLowerCase() === "egress";
      const type = isEgress ? "EGRESO" : "INGRESO";

      const locationName = isEgress
        ? String(d.depositoOrigen || d.depositoDestino || "").trim()
        : String(d.depositoDestino || d.depositoOrigen || "").trim();

      const rewardRaw = String(d.recompensa ?? "").trim();
      const isCafeCombo = CAFE_CODES.test(rewardRaw);

      return {
        id: String(d._id),
        // la fecha se manda como viene de la BD (texto)
        date: String(d.fecha ?? ""),
        prizeName: cleanPrizeName(rewardRaw),
        locationName,
        type, // INGR/EGRESO para el front
        quantity: Number(d.cantidad ?? 0) || 0,
        entity: String(d.entidad ?? "").trim(),
        rewardRaw,
        isCafeCombo,
        movement: movementRaw, // "Adjustment", "Egress", etc.
        lastUpdated,           // misma fecha para todas las filas
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
