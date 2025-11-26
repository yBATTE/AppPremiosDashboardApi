// src/services/mail.ts
import nodemailer from "nodemailer";
import type { UserRole } from "../models/User";

const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpFrom =
  process.env.SMTP_FROM || '"Premios Grupo Gen" <no-reply@grupogen.com.ar>';

const appName = process.env.APP_NAME || "Premios Grupo Gen";
const appUrl =
  process.env.APP_URL || "https://app-premios-dashboard.vercel.app";

// Si falta config, logueamos una vez
if (!smtpHost || !smtpUser || !smtpPass) {
  console.warn(
    "[mail] SMTP no configurado correctamente. Revisá SMTP_HOST / SMTP_USER / SMTP_PASS"
  );
}

// Transporter reutilizable
const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465, // true para 465, false para otros
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

export async function sendNewUserEmail(options: {
  to: string;
  password: string;
  role: UserRole;
}) {
  const { to, password, role } = options;

  // Si no hay config SMTP, no intentamos enviar (y no rompemos el flujo)
  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn(
      `[mail] Saltando envío de email a ${to} porque falta configuración SMTP`
    );
    return;
  }

  const subject = `${appName} - Tu usuario fue creado`;
  const text = `
Hola,

Te crearon un usuario para ${appName}.

Usuario: ${to}
Contraseña: ${password}
Rol: ${role}

Podés ingresar en:
${appUrl}

Te recomendamos cambiar la contraseña después del primer inicio de sesión.

Saludos,
Equipo ${appName}
`.trim();

  await transporter.sendMail({
    from: smtpFrom,
    to,
    subject,
    text,
  });
}
