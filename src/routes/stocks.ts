import { Router } from "express";
import { getExtractConn } from "../db/extractData";
import { AgrItemModel } from "../models/extract/AgrItem";

const router = Router();

// Descripciones a excluir
const EXCLUDED_DESCRIPTIONS = new Set<string>([
  "CAFE + FACTURA O ALFAJOR",
  "CAFE CHICO PARA LLEVAR + 2 FACTURAS",
  "CANJE CAFE + ALFAJOR",
  "GASEOSA + ALFAJOR",
]);

// Formatea fecha a hora de Buenos Aires: dd/mm/aaaa hh:mm:ss
const formatArgentinaDate = (
  d: Date | string | null | undefined
): string | null => {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",      // 4 dígitos
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

router.get("/", async (_req, res) => {
  try {
    const conn = await getExtractConn();
    const AgrItem = AgrItemModel(conn);

    // Traemos todos los stocks
    const rows = await AgrItem.find().lean().exec();

    // Buscamos la última fecha de actualización en OTHERITEMS
    const db = (conn as any).db;
    let lastUpdated: string | null = null;

    if (db) {
      const docs = await db
        .collection("otheritems")
        .find({})
        .sort({ scrapedAt: -1 }) // el más reciente primero
        .limit(1)
        .toArray();

      if (docs.length > 0 && docs[0].scrapedAt) {
        lastUpdated = formatArgentinaDate(docs[0].scrapedAt);
      }
    }

    const out: any[] = [];
    for (const r of rows) {
      const rawName = r.description ?? "—";
      const normalizedName = rawName.trim().toUpperCase();

      // Si el premio está en la lista de excluidos, lo salteamos
      if (EXCLUDED_DESCRIPTIONS.has(normalizedName)) continue;

      const name = rawName;

      const pushRow = (locationName: string, qty: unknown) => {
        const n = typeof qty === "number" ? qty : Number(qty ?? 0) || 0;
        out.push({
          _id: `${r._id}-${locationName}`,
          prizeName: name,
          locationName,
          quantity: n,
          minQuantity: 0,
          lastUpdated, // 👈 misma fecha para todas las filas
        });
      };

      pushRow("DEPOSITO GRUPO GEN", r.stock_grupogen);
      pushRow("DEPOSITO MONTEVERDE", r.stock_monteverde);
      pushRow("DEPOSITO BETTICA", r.stock_bettica);
      pushRow("DEPOSITO TOBAGO 1", r.stock_tobago1);
    }

    res.json(out);
  } catch (err: any) {
    console.error("GET /api/stocks", err);
    res
      .status(500)
      .json({ message: err?.message || "Error al obtener stock" });
  }
});

export default router;
