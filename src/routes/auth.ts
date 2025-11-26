// src/routes/auth.ts
import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { AuthRequest } from "../types";
import { requireAuth } from "../middleware/auth"; // Vamos a crear este middleware
import { requireAdmin } from "../middleware/auth"; // Vamos a crear este middleware también

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "cambia_este_secreto";

// POST /api/auth/login -> login de usuario
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ message: "Email y contraseña son requeridos" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).exec();
    if (!user) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error("Error en /login", err);
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/auth/me -> devuelve los datos del usuario logueado
router.get("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user?.id).exec();
    if (!user) {
      return res.status(401).json({ message: "No autorizado" });
    }

    return res.json({
      id: user.id,
      email: user.email,
      role: user.role
    });
  } catch (err) {
    console.error("Error en /me", err);
    return res.status(401).json({ message: "Token inválido" });
  }
});

export default router;
