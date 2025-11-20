import { Connection, Model, Schema } from "mongoose";

export interface OtherItemDoc {
  // definí lo que necesites aquí si lo vas a usar
  any?: any;
}

const OtherItemSchema = new Schema<OtherItemDoc>(
  {},
  { collection: "otheritems", versionKey: false, strict: false }
);

export const OtherItemModel = (conn: Connection): Model<OtherItemDoc> =>
  (conn.models.OtherItem as Model<OtherItemDoc>) ||
  conn.model<OtherItemDoc>("OtherItem", OtherItemSchema);
