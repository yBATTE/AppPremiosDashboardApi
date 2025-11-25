import { Router } from "express";
import { getExtractConn } from "../db/extractData";
import { OtherItemModel } from "../models/extract/OtherItem";
import { OtherItemHistoryModel } from "../models/extract/OtherItemHistory";

const router = Router();

const CAFE_CODES = /^\s*\((1062|1063|1064)\)\s*/i;

function cleanPrizeName(raw: string) {
  return String(raw ?? "").replace(/^\(\d+\)\s*/, "").trim();
}

// Parse "dd/MM/yyyy HH:mm:ss"
function parseArDateTime(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const [datePart, timePart] = trimmed.split(" ");
  if (!datePart) return null;

  const [dd, mm, yyyy] = datePart.split("/");
  const day = Number.parseInt(dd, 10);
  const month = Number.parseInt(mm, 10);
  const year = Number.parseInt(yyyy, 10);
  if (!day || !month || !year) return null;

  let h = 0, m = 0, s = 0;
  if (timePart) {
    const [hh, mm2, ss] = timePart.split(":");
    h = Number.parseInt(hh ?? "0", 10) || 0;
    m = Number.parseInt(mm2 ?? "0", 10) || 0;
    s = Number.parseInt(ss ?? "0", 10) || 0;
  }

  return new Date(year, month - 1, day, h, m, s);
}

// Parse "dd/MM/yyyy" que viene del móvil
function parseFilterDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const [dd, mm, yyyy] = trimmed.split("/");
  const day = Number.parseInt(dd, 10);
  const month = Number.parseInt(mm, 10);
  const year = Number.parseInt(yyyy, 10);
  if (!day || !month || !year) return null;

  return new Date(year, month - 1, day);
}

// Fecha a hora Argentina (para mostrar "Actualizado: ...")
function formatArgentinaDate(
  d: Date | string | null | undefined
): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
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

router.get("/", async (req, res) => {
  try {
    const conn = await getExtractConn();
    const OtherItem = OtherItemModel(conn);
    const OtherItemHistory = OtherItemHistoryModel(conn);

    // 👇 Unimos mes actual + históricos
    const [docsCurrent, docsHistory] = await Promise.all([
      OtherItem.find().lean().exec(),
      OtherItemHistory.find().lean().exec(),
    ]);

    const docs: any[] = [...docsCurrent, ...docsHistory];

    // Última fecha de actualización (scrapedAt más reciente)
    let lastUpdated: string | null = null;
    if (docs.length > 0) {
      let latest: Date | null = null;
      for (const d of docs) {
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

    // 👇 vienen como dd/MM/yyyy desde Flutter
    if (typeof startDate === "string" && startDate.trim()) {
      from = parseFilterDate(startDate);
    }
    if (typeof endDate === "string" && endDate.trim()) {
      to = parseFilterDate(endDate);
      if (to) {
        // incluir todo el día final
        to.setHours(23, 59, 59, 999);
      }
    }

    const filteredDocs = docs.filter((d) => {
      if (!from && !to) return true;

      const rawFecha = String(d.fecha ?? "").trim();
      const dDate = parseArDateTime(rawFecha);
      if (!dDate) return false; // si no podemos parsear, lo excluimos cuando hay filtro

      if (from && dDate < from) return false;
      if (to && dDate > to) return false;
      return true;
    });

    const rows = filteredDocs.map((d) => {
      const movementRaw = String(d.movimiento ?? "").trim();
      const isEgress = movementRaw.toLowerCase() === "egress";
      const type = isEgress ? "EGRESO" : "INGRESO";

      const locationName = isEgress
        ? String(d.depositoOrigen || d.depositoDestino || "").trim()
        : String(d.depositoDestino || d.depositoOrigen || "").trim();

      const rewardRaw = String(d.recompensa ?? "").trim();
      const isCafeCombo = CAFE_CODES.test(rewardRaw);

      const fechaRaw = String(d.fecha ?? "").trim();
      const parsedDate = parseArDateTime(fechaRaw);

      return {
        id: String(d._id),
        // 👇 enviamos ISO para que Flutter pueda parsear bien
        date: parsedDate ? parsedDate.toISOString() : fechaRaw,
        prizeName: cleanPrizeName(rewardRaw),
        locationName,
        type, // "INGRESO" | "EGRESO"
        quantity: Number(d.cantidad ?? 0) || 0,
        entity: String(d.entidad ?? "").trim(),
        rewardRaw,
        isCafeCombo,
        movement: movementRaw, // "Adjustment", "Egress", etc.
        lastUpdated, // misma para todas
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
