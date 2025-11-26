// src/routes/users.ts
import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { User, UserRole } from "../models/User";
import { AuthRequest, requireAuth, requireAdmin } from "../middleware/auth";
import { sendNewUserEmail } from "../services/mail"; // 👈 nuevo import

const router = Router();

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// POST /api/users  -> crear usuario (sólo ADMIN)
router.post(
  "/",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { email, password, role } = req.body as {
        email?: string;
        password?: string;
        role?: UserRole;
      };

      if (!email || !password) {
        return res
          .status(400)
          .json({ message: "Email y contraseña son obligatorios" });
      }

      const normEmail = normalizeEmail(email);

      const allowedRoles: UserRole[] = ["ADMIN", "OPERADOR", "VIEWER"];
      const finalRole: UserRole = allowedRoles.includes(role as UserRole)
        ? (role as UserRole)
        : "VIEWER";

      const existing = await User.findOne({ email: normEmail }).exec();
      if (existing) {
        return res
          .status(409)
          .json({ message: "Ya existe un usuario con ese email" });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await User.create({
        email: normEmail,
        passwordHash,
        role: finalRole,
      });

      // 👇 Intentamos enviar el mail (pero no rompemos el alta si falla)
      try {
        await sendNewUserEmail({
          to: user.email,
          password, // la contraseña en claro que recibió el admin
          role: user.role as UserRole,
        });
      } catch (mailErr) {
        console.error("Error enviando email de nuevo usuario:", mailErr);
        // Podrías agregar un campo "emailWarning" en la respuesta si querés
      }

      return res.status(201).json({
        id: user._id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      });
    } catch (err) {
      console.error("Error en POST /api/users:", err);
      return res.status(500).json({
        message: "Error al crear el usuario, revisá el servidor",
      });
    }
  }
);

// GET /api/users -> listar usuarios (sólo ADMIN)
router.get(
  "/",
  requireAuth,
  requireAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const users = await User.find({})
        .select("email role createdAt")
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      return res.json(users);
    } catch (err) {
      console.error("Error en GET /api/users:", err);
      return res
        .status(500)
        .json({ message: "Error al obtener usuarios" });
    }
  }
);

export default router;
