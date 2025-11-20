import mongoose, { Connection } from "mongoose";
import dotenv from "dotenv";
dotenv.config();

let extractConn: Connection | null = null;

export async function getExtractConn(): Promise<Connection> {
  if (extractConn && extractConn.readyState === 1) return extractConn;

  const uri = process.env.MONGO_URI_REWARDS;
  if (!uri) throw new Error("MONGO_URI_REWARDS no está definido en .env");

  extractConn = await mongoose.createConnection(uri).asPromise();
  return extractConn;
}
