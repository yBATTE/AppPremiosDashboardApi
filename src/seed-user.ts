import mongoose from "mongoose"
import dotenv from "dotenv"
import bcrypt from "bcryptjs"
import { User, UserRole } from "./models/User"

dotenv.config()

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/premios"

async function run() {
  try {
    await mongoose.connect(MONGO_URI)
    console.log("Conectado a MongoDB")

    const email = process.env.SEED_EMAIL || "admin@grupogen.com.ar"
    const password = process.env.SEED_PASSWORD || "123456"
    const role = (process.env.SEED_ROLE as UserRole) || "VIEWER"

    const existing = await User.findOne({ email }).exec()
    if (existing) {
      console.log(`Ya existe un usuario con email ${email}`)
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)
    await User.create({ email, passwordHash, role })

    console.log("Usuario creado:")
    console.log({ email, role })
  } catch (err) {
    console.error("Error en seed:", err)
  } finally {
    await mongoose.disconnect()
    process.exit(0)
  }
}

run()
