import { Connection, Model, Schema } from "mongoose";

export interface OtherItemHistoryDoc {
  // estructura flexible, igual que OtherItem
  any?: any;
}

const OtherItemHistorySchema = new Schema<OtherItemHistoryDoc>(
  {},
  {
    collection: "otheritemhistories",
    versionKey: false,
    strict: false,
  }
);

export const OtherItemHistoryModel = (
  conn: Connection
): Model<OtherItemHistoryDoc> =>
  (conn.models.OtherItemHistory as Model<OtherItemHistoryDoc>) ||
  conn.model<OtherItemHistoryDoc>("OtherItemHistory", OtherItemHistorySchema);
