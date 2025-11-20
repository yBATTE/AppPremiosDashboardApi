import { Connection, Model, Schema } from "mongoose";

export interface CoffeeMovementDoc {
  tipoCafe?: string | null;
  egresos?: Array<{
    entidad?: string | null;
    cantidad?: number | string | null;
  }>;
  scrapedAt?: Date | string | null;
}

const CoffeeMovementSchema = new Schema<CoffeeMovementDoc>(
  {
    tipoCafe: String,
    egresos: [
      {
        entidad: String,
        cantidad: Schema.Types.Mixed,
      },
    ],
    scrapedAt: Schema.Types.Mixed,
  },
  { collection: "coffeemovements", versionKey: false }
);

export const CoffeeMovementModel = (
  conn: Connection
): Model<CoffeeMovementDoc> =>
  (conn.models.CoffeeMovement as Model<CoffeeMovementDoc>) ||
  conn.model<CoffeeMovementDoc>("CoffeeMovement", CoffeeMovementSchema);
