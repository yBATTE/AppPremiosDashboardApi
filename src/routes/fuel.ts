// src/routes/fuel.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";

// 👇 Estos 3 handlers los implementás en el service (te dejo el archivo abajo)
import {
  getSalesDayOneStation,
  getSalesDayAllStations,
  getSalesMonthOneStation,
} from "../services/fuel";



const router = Router();

// Helpers
function toInt(v: unknown, def: number | null = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

// GET /api/fuel/sales?stationId=20&year=2026&month=2&day=23
router.get("/sales", requireAuth, async (req, res) => {
  try {
    const stationId = String(req.query.stationId ?? "").trim();
    const year = toInt(req.query.year);
    const month = toInt(req.query.month);
    const day = toInt(req.query.day);

    if (!stationId || !year || !month || !day) {
      return res.status(400).json({
        error: "Faltan parámetros: stationId, year, month, day",
      });
    }

    const data = await getSalesDayOneStation({ stationId, year, month, day });
    return res.json(data);
  } catch (err: any) {
    console.error("GET /api/fuel/sales", err);
    return res.status(500).json({
      error: err?.message || "Error interno en fuel/sales",
    });
  }
});

// GET /api/fuel/sales/all?year=2026&month=2&day=23
router.get("/sales/all", requireAuth, async (req, res) => {
  try {
    const year = toInt(req.query.year);
    const month = toInt(req.query.month);
    const day = toInt(req.query.day);

    if (!year || !month || !day) {
      return res.status(400).json({
        error: "Faltan parámetros: year, month, day",
      });
    }

    const data = await getSalesDayAllStations({ year, month, day });
    return res.json(data);
  } catch (err: any) {
    console.error("GET /api/fuel/sales/all", err);
    return res.status(500).json({
      error: err?.message || "Error interno en fuel/sales/all",
    });
  }
});

// GET /api/fuel/sales/month?stationId=20&year=2026&month=2&toDay=23
router.get("/sales/month", requireAuth, async (req, res) => {
  try {
    const stationId = String(req.query.stationId ?? "").trim();
    const year = toInt(req.query.year);
    const month = toInt(req.query.month);
    const toDay = toInt(req.query.toDay);

    if (!stationId || !year || !month || !toDay) {
      return res.status(400).json({
        error: "Faltan parámetros: stationId, year, month, toDay",
      });
    }

    const data = await getSalesMonthOneStation({ stationId, year, month, toDay });
    return res.json(data);
  } catch (err: any) {
    console.error("GET /api/fuel/sales/month", err);
    return res.status(500).json({
      error: err?.message || "Error interno en fuel/sales/month",
    });
  }
});

export default router;