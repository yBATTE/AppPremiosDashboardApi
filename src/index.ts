import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import { connectPrimary } from "./db/primary";

// rutas
import prizesRouter from "./routes/prizes";
import stocksRouter from "./routes/stocks";
import movementsRouter from "./routes/movements";
import cafesRouter from "./routes/cafes";

async function main() {
  await connectPrimary(); // DB de users (login etc.)

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use("/api/prizes", prizesRouter);
  app.use("/api/stocks", stocksRouter);
  app.use("/api/movements", movementsRouter);
  app.use("/api/cafes", cafesRouter);
  app.use("/api/auth", await import("./routes/auth").then((m) => m.default));

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`API escuchando en :${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
