// src/utils/movements.ts

export type MovementType = "INGRESO" | "EGRESO";

/**
 * Deriva el tipo (INGRESO / EGRESO) a partir del texto `movement`
 * Ej: "Egress", "Egreso", "Salida", "Out", "Exit" → EGRESO
 */
export function getTypeFromMovement(movement?: string): MovementType {
  if (!movement) return "INGRESO";

  const T = movement.toString().toUpperCase();

  if (/(EGRES|EGRESS|SALID|OUT|EXIT)/.test(T)) {
    return "EGRESO";
  }

  return "INGRESO";
}
