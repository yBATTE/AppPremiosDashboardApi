import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

export async function connectPrimary() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Falta MONGO_URI");
  await mongoose.connect(uri);
  console.log("✅ Conectado a DB principal (users)");
}
