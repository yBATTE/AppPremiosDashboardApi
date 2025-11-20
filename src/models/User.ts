import { Schema, model, Document } from "mongoose"

export type UserRole = "ADMIN" | "OPERADOR" | "VIEWER"

export interface IUser extends Document {
  email: string
  passwordHash: string
  role: UserRole
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["ADMIN", "OPERADOR", "VIEWER"],
      default: "VIEWER",
      required: true
    }
  },
  { timestamps: true }
)

export const User = model<IUser>("User", userSchema)
