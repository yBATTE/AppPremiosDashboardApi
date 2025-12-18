import { Connection, Types } from "mongoose";
import { getFirebaseAdmin } from "./firebase";

type Result =
  | { ok: true; notified: false; reason: "init" | "no_changes" | "no_movements" }
  | { ok: true; notified: true; reason: "notified"; newCount?: number }
  | { ok: false; error: string };

function isValidObjectId(id: string) {
  return Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id;
}

function clean(v: any) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

// Firma “humana” opcional (solo para debug / logs)
function signatureFromOtherItem(doc: any) {
  const fecha = clean(doc.fecha);
  const entidad = clean(doc.entidad);
  const movimiento = clean(doc.movimiento);
  const documento = clean(doc.documento);
  const cantidad = clean(doc.cantidad);
  const recompensa = clean(doc.recompensa);
  const depositoOrigen = clean(doc.depositoOrigen);
  const depositoDestino = clean(doc.depositoDestino);

  return [
    fecha,
    entidad,
    movimiento,
    documento,
    cantidad ? `(${cantidad})` : "",
    recompensa,
    depositoOrigen,
    depositoDestino,
  ]
    .filter(Boolean)
    .join("|");
}

export async function checkAndNotifyMovements(
  extractConn: Connection, // 👈 LEE: ExtractData
  primaryConn: Connection  // 👈 GUARDA estado: Primary
): Promise<Result> {
  try {
    // 1) Leer último otheritem (NO escribimos nada en otheritems)
    const otherItemsCol = extractConn.collection("otheritems");

    const latest = await otherItemsCol.findOne(
      {},
      { sort: { scrapedAt: -1, _id: -1 } }
    );

    if (!latest?._id) return { ok: true, notified: false, reason: "no_movements" };

    const latestId = String(latest._id);
    const latestSig = signatureFromOtherItem(latest);

    // 2) Leer estado en Primary
    const stateCol = primaryConn.collection("notification_state");
    const key = "movements";

    const state: any = await stateCol.findOne({ key });

    // compat con tu doc viejo:
    const lastId =
      clean(state?.lastOtherItemId) ||
      clean(state?.lastMovementObjectId) ||
      clean(state?.lastMovementId); // por si quedó algo viejo

    // 3) Primera vez: guardamos y NO notificamos
    if (!lastId) {
      await stateCol.updateOne(
        { key },
        {
          $set: {
            key,
            lastOtherItemId: latestId,
            lastSignature: latestSig,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      return { ok: true, notified: false, reason: "init" };
    }

    // 4) Si no cambió el último -> no notificar
    if (lastId === latestId) {
      return { ok: true, notified: false, reason: "no_changes" };
    }

    // 5) (Opcional) contar cuántos nuevos hubo desde el último id
    let newCount: number | undefined = undefined;
    if (isValidObjectId(lastId)) {
      try {
        newCount = await otherItemsCol.countDocuments({
          _id: { $gt: new Types.ObjectId(lastId) },
        });
        if (!Number.isFinite(newCount) || newCount <= 0) newCount = undefined;
      } catch {
        newCount = undefined;
      }
    }

    // 6) Enviar push (topic movements)
    const admin = getFirebaseAdmin();

    const body =
      newCount && newCount > 1
        ? `Hay nuevos movimientos (${newCount}). Entrá a la app para verlos.`
        : "No te pierdas los nuevos movimientos. Entrá a la app para verlos.";

    await admin.messaging().send({
      topic: "movements",
      notification: {
        title: "Grupo GEN",
        body,
      },
      data: {
        kind: "movements",
        latestId,
        count: newCount ? String(newCount) : "1",
      },
    });

    // 7) Actualizar estado en Primary
    await stateCol.updateOne(
      { key },
      {
        $set: {
          lastOtherItemId: latestId,
          lastSignature: latestSig,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return { ok: true, notified: true, reason: "notified", newCount };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
