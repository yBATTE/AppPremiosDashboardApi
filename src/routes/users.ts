// src/routes/users.ts
import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { User, UserRole } from "../models/User";
import { AuthRequest, requireAuth, requireAdmin } from "../middleware/auth";
import { sendNewUserEmail } from "../services/mail";

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

      // 👉 Verificar que no exista otro usuario con ese email
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

      // Intentar enviar mail (no rompe el alta si falla)
      try {
        await sendNewUserEmail({
          to: user.email,
          password,
          role: user.role as UserRole,
        });
      } catch (mailErr) {
        console.error("Error enviando email de nuevo usuario:", mailErr);
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

// POST /api/users/change-password -> cambiar contraseña propia (cualquier rol)
router.post(
  "/change-password",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      if (!currentPassword || !newPassword) {
        return res
          .status(400)
          .json({ message: "Contraseña actual y nueva son obligatorias" });
      }

      if (newPassword.length < 4) {
        return res
          .status(400)
          .json({ message: "La nueva contraseña es demasiado corta" });
      }

      const userId = req.user?.id; // 👈 viene del middleware requireAuth
      if (!userId) {
        return res.status(401).json({ message: "No autorizado" });
      }

      const user = await User.findById(userId).exec();
      if (!user) {
        return res.status(401).json({ message: "No autorizado" });
      }

      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) {
        return res
          .status(400)
          .json({ message: "La contraseña actual no es correcta" });
      }

      user.passwordHash = await bcrypt.hash(newPassword, 10);
      await user.save();

      return res.json({ message: "Contraseña actualizada correctamente" });
    } catch (err) {
      console.error("Error en POST /api/users/change-password:", err);
      return res
        .status(500)
        .json({ message: "Error al cambiar la contraseña" });
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
