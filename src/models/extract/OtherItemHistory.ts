import { Connection, Model, Schema } from "mongoose";

export interface OtherItemHistoryDoc {
  any?: any;
}

const OtherItemHistorySchema = new Schema<OtherItemHistoryDoc>(
  {},
  {
    collection: "otheritemhistories", // 👈 nombre de la colección
    versionKey: false,
    strict: false,
  }
);

export const OtherItemHistoryModel = (conn: Connection): Model<OtherItemHistoryDoc> =>
  (conn.models.OtherItemHistory as Model<OtherItemHistoryDoc>) ||
  conn.model<OtherItemHistoryDoc>("OtherItemHistory", OtherItemHistorySchema);
