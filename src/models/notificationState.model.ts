import { Connection, Model, Schema } from "mongoose";

export interface NotificationStateDoc {
  key: string; // "movements"
  lastMovementId?: string | null;
  lastSignature?: string | null;
  updatedAt?: Date;
}

const NotificationStateSchema = new Schema<NotificationStateDoc>(
  {
    key: { type: String, required: true, unique: true },
    lastMovementId: { type: String, default: null },
    lastSignature: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "notification_state", versionKey: false }
);

export const NotificationStateModel = (conn: Connection): Model<NotificationStateDoc> =>
  (conn.models.NotificationState as Model<NotificationStateDoc>) ||
  conn.model<NotificationStateDoc>("NotificationState", NotificationStateSchema);
