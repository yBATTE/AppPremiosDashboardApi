// src/routes/cafes.ts
import { Router } from "express";
import { getExtractConn } from "../db/extractData";
import { CoffeeMovementModel } from "../models/extract/CoffeeMovement";

const router = Router();

interface CoffeeDoc {
  tipoCafe?: string | null;
  egresos?: Array<{
    entidad?: string | null;
    cantidad?: number | string | null;
  }>;
  scrapedAt?: Date | string | null;
  periodMonth?: string | null; // sólo histórico
}

function mapEntidadToDeposito(entidad: unknown): string {
  const s = String(entidad ?? "").toLowerCase();
  if (s.includes("monteverde")) return "DEPOSITO MONTEVERDE";
  if (s.includes("bettica")) return "DEPOSITO BETTICA";
  if (s.includes("tobago")) return "DEPOSITO TOBAGO 1";
  return typeof entidad === "string" && entidad.trim() ? entidad : "—";
}

function currentMonthKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // ej "2025-11"
}

router.get("/", async (req, res) => {
  try {
    const conn = await getExtractConn();
    if (!conn) {
      throw new Error("No se pudo obtener la conexión a Mongo (extract)");
    }

    const CoffeeMovement = CoffeeMovementModel(conn);

    // ?month=YYYY-MM  (si no viene → mes actual)
    const monthParamRaw =
      typeof req.query.month === "string" ? req.query.month.trim() : "";
    const monthKey = monthParamRaw || currentMonthKey();
    const isCurrentMonth = monthKey === currentMonthKey();

    let docs: CoffeeDoc[] = [];

    if (isCurrentMonth) {
      // Mes actual → colección live "coffeemovements"
      docs = (await CoffeeMovement.find().lean().exec()) as CoffeeDoc[];
    } else {
      // Meses anteriores → colección histórica "coffeemovementhistories"
      const db = conn.db; // acá TS ya sabe que conn no es undefined
      if (!db) {
        throw new Error("La conexión no tiene propiedad 'db'");
      }

      docs = (await db
        .collection("coffeemovementhistories")
        .find({ periodMonth: monthKey })
        .toArray()) as CoffeeDoc[];
    }

    const totals = new Map<string, number>();

    for (const d of docs) {
      const egresos = Array.isArray(d.egresos) ? d.egresos : [];
      for (const eg of egresos) {
        const dep = mapEntidadToDeposito(eg.entidad);
        const qtyRaw = eg.cantidad;
        const qty =
          typeof qtyRaw === "number" ? qtyRaw : Number(qtyRaw ?? 0);
        if (isNaN(qty)) continue;

        totals.set(dep, (totals.get(dep) ?? 0) + qty);
      }
    }

    res.json([
      {
        id: "monteverde",
        locationName: "DEPOSITO MONTEVERDE",
        totalQuantity: totals.get("DEPOSITO MONTEVERDE") ?? 0,
      },
      {
        id: "bettica",
        locationName: "DEPOSITO BETTICA",
        totalQuantity: totals.get("DEPOSITO BETTICA") ?? 0,
      },
      {
        id: "tobago1",
        locationName: "DEPOSITO TOBAGO 1",
        totalQuantity: totals.get("DEPOSITO TOBAGO 1") ?? 0,
      },
    ]);
  } catch (err: any) {
    console.error("GET /api/cafes", err);
    res.status(500).json({
      message: "Error al obtener cafés",
      error: err?.message || String(err),
    });
  }
});

export default router;
