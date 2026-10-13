import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    activeSchoolYearId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolYear", default: null },
    legacyRules: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    sessionVersion: { type: Number, default: 0 },
    recoveryHash: { type: String, select: false },
    loginFailures: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    legacyId: {
      type: Number,
      unique: true,
      sparse: true,
      index: true,
    },

    name: {
      type: String,
      required: [
        true,
        "User name is required.",
      ],
      trim: true,
    },

    nameKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    password: {
      type: String,
      required: [
        true,
        "Password is required.",
      ],
    },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

userSchema.pre("validate", function normalizeUser() {
  if (typeof this.name === "string") {
    this.name = this.name
      .trim()
      .replace(/\s+/g, " ");

    this.nameKey =
      this.name.toLowerCase();
  }
});

const User =
  mongoose.models.User ||
  mongoose.model(
    "User",
    userSchema,
  );

export default User;