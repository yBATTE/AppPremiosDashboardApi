// src/routes/premios.ts
import { Router } from "express";
import { PremiosService } from "../services/premios.service";

const router = Router();
const service = new PremiosService();

// GET /api/premios?year=2026&force=1&forcePoints=1
router.get("/", async (req, res) => {
  try {
    const year = Number(req.query.year || new Date().getFullYear());
    const force = String(req.query.force || "0") === "1";
    const forcePoints = String(req.query.forcePoints || "0") === "1";

    const data = await service.getPremios(year, { force, forcePoints });
    return res.json(data);
  } catch (e: any) {
    console.error("GET /api/premios error:", e);
    return res.status(500).json({ error: e?.message || "Error /api/premios" });
  }
});

// POST /api/premios/refresh  { "year": 2026, "forcePoints": true }
router.post("/refresh", async (req, res) => {
  try {
    const year = Number(req.body?.year || new Date().getFullYear());
    const forcePoints = !!req.body?.forcePoints;

    const out = await service.refreshPremios(year, { forcePoints });
    return res.json(out);
  } catch (e: any) {
    console.error("POST /api/premios/refresh error:", e);
    return res.status(500).json({ error: e?.message || "Error /api/premios/refresh" });
  }
});

export default router;