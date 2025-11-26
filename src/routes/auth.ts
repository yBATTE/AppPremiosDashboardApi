// src/routes/auth.ts
import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { AuthRequest } from "../types";
import { requireAuth } from "../middleware/auth"; // Vamos a crear este middleware
import { requireAdmin } from "../middleware/auth"; // Vamos a crear este middleware también
import { sendPasswordResetCodeEmail } from "../services/mail";
import * as crypto from 'crypto'; // Importación correcta


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

// POST /api/auth/reset-password -> enviar código al email
router.post('/reset-password', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email }).exec();

  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }

  const resetCode = crypto.randomBytes(3).toString('hex'); // Generamos código aleatorio

  // Configurar expiración del código (10 minutos)
  const expirationTime = Date.now() + 10 * 60 * 1000; // 10 minutos

  user.resetCode = resetCode;
  user.resetCodeExpiration = new Date(expirationTime); // Establecer la expiración del código

  await user.save();

  // Enviar el código al usuario
  try {
    await sendPasswordResetCodeEmail({
      to: user.email,
      code: resetCode,
    });
    return res.status(200).json({ message: 'Código enviado' });
  } catch (err) {
    console.error('Error enviando email:', err);
    return res.status(500).json({ message: 'Error al enviar el correo' });
  }
});

// POST /api/auth/confirm-reset-code -> verificar código y actualizar contraseña
router.post('/confirm-reset-code', async (req, res) => {
  const { email, code, newPassword } = req.body;

  const user = await User.findOne({ email }).exec();

  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }

  // Verificar si el código es válido y si no ha expirado
  if (user.resetCode !== code) {
    return res.status(400).json({ message: 'Código incorrecto' });
  }

  if (user.resetCodeExpiration && user.resetCodeExpiration < new Date()) {
    return res.status(400).json({ message: 'El código ha expirado' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  user.passwordHash = passwordHash;
  user.resetCode = undefined; // Limpiar el código de restablecimiento
  user.resetCodeExpiration = undefined; // Limpiar la fecha de expiración

  await user.save();

  return res.status(200).json({ message: 'Contraseña actualizada correctamente' });
});

export default router;
