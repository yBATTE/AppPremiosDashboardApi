// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "../models/User";

const JWT_SECRET = process.env.JWT_SECRET || "cambia_este_secreto";

export interface AuthUser {
  id?: string;
  email: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Token no enviado" });
    }

    const token = header.split(" ")[1];

    const payload = jwt.verify(token, JWT_SECRET) as any;

    const email = (payload.email || "").toString();
    const role = (payload.role || "VIEWER") as UserRole;
    const id = payload.sub ? payload.sub.toString() : undefined;

    if (!email) {
      return res.status(401).json({ message: "Token inválido" });
    }

    req.user = { id, email, role };

    next();
  } catch (err) {
    console.error("Error en requireAuth:", err);
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "No autenticado" });
  }

  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Sólo un ADMIN puede realizar esta acción" });
  }

  next();
}
