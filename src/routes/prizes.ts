// src/routes/prizes.ts
import { Router } from "express";
import { getExtractConn } from "../db/extractData";
import { AgrItemModel } from "../models/extract/AgrItem";
import { requireAuth } from "../middleware/auth"; // Importamos el middleware de autenticación

const router = Router();

// convierte string/number/null a number seguro
const toNum = (v: unknown) =>
  typeof v === "number"
    ? v
    : Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;

// interpreta el status de la BD en un booleano "active"
const parseActive = (status: unknown): boolean => {
  const s = String(status ?? "").trim().toLowerCase();

  if (!s) return true; // por defecto lo consideramos activo

  // casos tal cual vienen de la BD
  if (s === "true active" || s === "active") return true;
  if (s === "true inactive" || s === "inactive") return false;

  // por si cambia el formato
  if (s.includes("inactive")) return false;
  if (s.includes("active")) return true;

  return true;
};

// formatea la fecha a hora de Buenos Aires
const formatArgentinaDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  return new Date(d).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

// Ruta protegida para obtener premios
router.get(
  "/",
  requireAuth, // Asegura que el usuario esté autenticado
  async (_req, res) => {
    try {
      const conn = await getExtractConn();
      const AgrItem = AgrItemModel(conn);

      const rows = await AgrItem.find().lean().exec();

      const out = rows.map((r) => ({
        _id: String(r._id),
        name: r.description ?? "—",
        category: r.category ?? "",
        // para el dashboard (costo unitario)
        defaultPurchasePrice: toNum(r.cost),
        // para la pantalla de Premios (mostrar puntos)
        points: toNum(r.points),
        // estado ya normalizado a booleano
        active: parseActive(r.status),
        // fecha formateada en hora Argentina
        scrapedAt: formatArgentinaDate((r as any).scrapedAt),
      }));

      res.json(out);
    } catch (err: any) {
      console.error("GET /api/prizes", err);
      res.status(500).json({ message: err?.message || "Error al obtener premios" });
    }
  }
);
// GET /api/prizes/inventory/valuation
router.get(
  "/inventory/valuation",
  requireAuth,
  async (req, res) => {
    try {
      const conn = await getExtractConn();
      const AgrItem = AgrItemModel(conn);

      // Si querés, podés elegir cómo calcular qty:
      // - by=global   -> usa stock_global (si existe) sino suma depósitos
      // - by=deposits -> suma depósitos siempre
      const by = String(req.query.by ?? "global"); // "global" | "deposits"
      const includeZero = String(req.query.includeZero ?? "1") === "1"; // 1/0

      const rows = await AgrItem.find().lean().exec();

      const items = rows.map((r: any) => {
        const unitCost = toNum(r.cost);
        const unitPrice = toNum(r.price);

        const stock_bettica = toNum(r.stock_bettica);
        const stock_grupogen = toNum(r.stock_grupogen);
        const stock_monteverde = toNum(r.stock_monteverde);
        const stock_tobago1 = toNum(r.stock_tobago1);

        const depositsQty =
          stock_bettica + stock_grupogen + stock_monteverde + stock_tobago1;

        const stock_global =
          r.stock_global === null || r.stock_global === undefined
            ? null
            : toNum(r.stock_global);

        // qty final
        const qty =
          by === "deposits"
            ? depositsQty
            : stock_global !== null
              ? stock_global
              : depositsQty;

        const totalCostValue = qty * unitCost;
        const totalSaleValue = qty * unitPrice;

        return {
          _id: String(r._id),
          name: r.description ?? "—",
          category: r.category ?? "",
          active: parseActive(r.status),

          qty,
          unitCost,
          unitPrice,
          totalCostValue,
          totalSaleValue,

          stocks: {
            stock_global: stock_global ?? undefined,
            stock_bettica,
            stock_grupogen,
            stock_monteverde,
            stock_tobago1,
          },

          scrapedAt: formatArgentinaDate(r.scrapedAt),
        };
      });

      const filtered = includeZero ? items : items.filter((i) => i.qty > 0);

      // Totales generales
      const totals = filtered.reduce(
        (acc, i) => {
          acc.products += 1;
          acc.totalQty += i.qty;
          acc.totalInventoryCost += i.totalCostValue;
          acc.totalInventorySale += i.totalSaleValue;
          return acc;
        },
        {
          products: 0,
          totalQty: 0,
          totalInventoryCost: 0,
          totalInventorySale: 0,
        }
      );

      // Totales por depósito (a costo)
      const byLocationCost = filtered.reduce(
        (acc, i) => {
          const c = i.unitCost;
          acc.BETTICA += (i.stocks.stock_bettica ?? 0) * c;
          acc.GRUPO_GEN += (i.stocks.stock_grupogen ?? 0) * c;
          acc.MONTEVERDE += (i.stocks.stock_monteverde ?? 0) * c;
          acc.TOBAGO_1 += (i.stocks.stock_tobago1 ?? 0) * c;
          return acc;
        },
        { BETTICA: 0, GRUPO_GEN: 0, MONTEVERDE: 0, TOBAGO_1: 0 }
      );

      // Totales por depósito (a precio de venta)
      const byLocationSale = filtered.reduce(
        (acc, i) => {
          const p = i.unitPrice;
          acc.BETTICA += (i.stocks.stock_bettica ?? 0) * p;
          acc.GRUPO_GEN += (i.stocks.stock_grupogen ?? 0) * p;
          acc.MONTEVERDE += (i.stocks.stock_monteverde ?? 0) * p;
          acc.TOBAGO_1 += (i.stocks.stock_tobago1 ?? 0) * p;
          return acc;
        },
        { BETTICA: 0, GRUPO_GEN: 0, MONTEVERDE: 0, TOBAGO_1: 0 }
      );

      // Ordenados por valor a costo (más caro arriba)
      filtered.sort((a, b) => b.totalCostValue - a.totalCostValue);

      res.json({
        by, // "global" o "deposits"
        includeZero,

        totals, // { products, totalQty, totalInventoryCost, totalInventorySale }

        byLocationCost,
        byLocationSale,

        items: filtered,
      });
    } catch (err: any) {
      console.error("GET /api/prizes/inventory/valuation", err);
      res
        .status(500)
        .json({ message: err?.message || "Error al calcular valuación" });
    }
  }
);


export default router;
