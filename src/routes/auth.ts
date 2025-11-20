import { Router } from "express"
import { User } from "../models/User"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { AuthRequest } from "../types"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "cambia_este_secreto"

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string }

    if (!email || !password) {
      return res.status(400).json({ message: "Email y contraseña son requeridos" })
    }

    const user = await User.findOne({ email: email.toLowerCase() }).exec()
    if (!user) {
      return res.status(401).json({ message: "Credenciales inválidas" })
    }

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      return res.status(401).json({ message: "Credenciales inválidas" })
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    )

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    })
  } catch (err) {
    console.error("Error en /login", err)
    res.status(500).json({ message: "Error interno" })
  }
})

router.get("/me", async (req: AuthRequest, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No autorizado" })
    }

    const token = authHeader.substring("Bearer ".length)
    const JWT_SECRET = process.env.JWT_SECRET || "cambia_este_secreto"

    const payload = jwt.verify(token, JWT_SECRET) as {
      sub: string
      email: string
      role: string
    }

    const user = await User.findById(payload.sub).exec()
    if (!user) {
      return res.status(401).json({ message: "No autorizado" })
    }

    return res.json({
      id: user.id,
      email: user.email,
      role: user.role
    })
  } catch (err) {
    console.error("Error en /me", err)
    return res.status(401).json({ message: "Token inválido" })
  }
})

export default router
