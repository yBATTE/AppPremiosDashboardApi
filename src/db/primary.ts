import mongoose, { Connection } from "mongoose";
import dotenv from "dotenv";
dotenv.config();

export async function connectPrimary(): Promise<Connection> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Falta MONGO_URI");

  await mongoose.connect(uri);
  console.log("✅ Conectado a DB principal");

  return mongoose.connection;
}
