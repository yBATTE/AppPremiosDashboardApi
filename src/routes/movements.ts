// src/routes/movements.ts
import { Router } from "express";
import { getExtractConn } from "../db/extractData";
import { OtherItemModel } from "../models/extract/OtherItem";

const router = Router();

const CAFE_CODES = /^\s*\((1062|1063|1064)\)\s*/i;

function cleanPrizeName(raw: string) {
  return String(raw ?? "").replace(/^\(\d+\)\s*/, "").trim();
}

// Fecha a hora Argentina
function formatArgentinaDate(d: Date | string | null | undefined): string | null {
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

router.get("/", async (req, res) => {
  try {
    const conn = await getExtractConn();
    const OtherItem = OtherItemModel(conn);

    const docs = await OtherItem.find().lean().exec();

    // Última fecha de actualización (scrapedAt más reciente)
    let lastUpdated: string | null = null;
    if (docs.length > 0) {
      let latest: Date | null = null;
      for (const d of docs as any[]) {
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

    if (typeof startDate === "string" && startDate.trim()) {
      from = new Date(startDate);
    }
    if (typeof endDate === "string" && endDate.trim()) {
      to = new Date(endDate);
      // incluir todo el día final
      to.setHours(23, 59, 59, 999);
    }

    const filteredDocs = docs.filter((d: any) => {
      if (!from && !to) return true;

      const rawFecha = String(d.fecha ?? "");
      const dDate = new Date(rawFecha);
      if (isNaN(dDate.getTime())) {
        // si no podemos parsear la fecha, lo excluimos cuando hay filtro
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
        date: String(d.fecha ?? ""),
        prizeName: cleanPrizeName(rewardRaw),
        locationName,
        type, // se sigue usando para PWA
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
