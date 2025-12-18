import { Connection, Model, Schema } from "mongoose";

export interface MovementDoc {
  [key: string]: any; // porque tu schema es strict:false
}

const MovementSchema = new Schema<MovementDoc>(
  {},
  { collection: "movements", versionKey: false, strict: false }
);

// ✅ Si tu colección NO se llama "movements", cambiá el string de collection arriba.
export const MovementModel = (conn: Connection): Model<MovementDoc> =>
  (conn.models.Movement as Model<MovementDoc>) ||
  conn.model<MovementDoc>("Movement", MovementSchema);
