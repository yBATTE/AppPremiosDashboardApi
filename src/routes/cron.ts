// import { Router } from "express";
// import type { Connection } from "mongoose";
// import { checkAndNotifyMovements } from "../services/movementsNotifier.service";

// const router = Router();

// router.get("/check-movements", async (req, res) => {
//   try {
//     const key = String(req.query.key ?? "");
//     const expected = String(process.env.CRON_SECRET ?? "");

//     if (!expected || key !== expected) {
//       return res.status(401).json({ ok: false, error: "unauthorized" });
//     }

//     const extractConn = req.app.locals.mongoExtract as Connection | undefined;
//     const primaryConn = req.app.locals.mongoPrimary as Connection | undefined;

//     if (!extractConn || !primaryConn) {
//       return res
//         .status(500)
//         .json({ ok: false, error: "mongo_connections_missing" });
//     }

//     // ✅ ACÁ van los 2 argumentos
//     const result = await checkAndNotifyMovements(extractConn, primaryConn);
//     return res.json(result);
//   } catch (e: any) {
//     return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
//   }
// });

// export default router;
