import { Connection, Model, Schema } from "mongoose";

export interface AgrItemDoc {
  description?: string;
  category?: string;
  stock_bettica?: number | string | null;
  stock_grupogen?: number | string | null;
  stock_monteverde?: number | string | null;
  stock_tobago1?: number | string | null;
  stock_global?: number | string | null;
  cost?: number | string | null;
  price?: number | string | null;
  points?: number | string | null;
  status?: string | null;
  scrapedAt?: Date | string | null;
}

const AgrItemSchema = new Schema<AgrItemDoc>(
  {
    description: String,
    category: String,
    stock_bettica: Schema.Types.Mixed,
    stock_grupogen: Schema.Types.Mixed,
    stock_monteverde: Schema.Types.Mixed,
    stock_tobago1: Schema.Types.Mixed,
    stock_global: Schema.Types.Mixed,
    cost: Schema.Types.Mixed,
    price: Schema.Types.Mixed,
    points: Schema.Types.Mixed,
    status: String,
    scrapedAt: Schema.Types.Mixed,
  },
  { collection: "agritems", versionKey: false }
);

export const AgrItemModel = (conn: Connection): Model<AgrItemDoc> =>
  (conn.models.AgrItem as Model<AgrItemDoc>) ||
  conn.model<AgrItemDoc>("AgrItem", AgrItemSchema);
