import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import { connectPrimary } from "./db/primary";
import { getExtractConn } from "./db/extractData";

// rutas
import prizesRouter from "./routes/prizes";
import stocksRouter from "./routes/stocks";
import movementsRouter from "./routes/movements";
import cafesRouter from "./routes/cafes";
import authRouter from "./routes/auth";
import usersRouter from "./routes/users";
import cronRoutes from "./routes/cron.routes";

async function main() {
  // ✅ Conexión primaria (users + notification_state)
  const primaryConn = await connectPrimary();

  // ✅ Conexión extract (donde están los movimientos reales)
  const extractConn = await getExtractConn();

  const app = express();
  app.use(cors());
  app.use(express.json());

  // ✅ disponibles para rutas/services
  app.locals.mongoPrimary = primaryConn;
  app.locals.mongoExtract = extractConn;

  // 🔹 Healthcheck simple
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      message: "Premios API funcionando",
      timestamp: new Date().toISOString(),
    });
  });

  // Rutas de la API
  app.use("/api/prizes", prizesRouter);
  app.use("/api/stocks", stocksRouter);
  app.use("/api/movements", movementsRouter);
  app.use("/api/cafes", cafesRouter);

  // Auth (login, etc.)
  app.use("/api/auth", authRouter);

  // Users (crear / listar usuarios)
  app.use("/api/users", usersRouter);

  // ✅ Cron notifier
  app.use("/api/cron", cronRoutes);

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`API escuchando en :${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
