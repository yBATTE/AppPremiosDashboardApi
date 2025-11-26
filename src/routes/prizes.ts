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

export default router;
