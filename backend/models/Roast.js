import mongoose from "mongoose";

const roastSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, index: true },
    avatar: { type: String, default: null },
    roast: { type: String, default: null },
    strength: { type: String, default: null },
    weakness: { type: String, default: null },
    loveLife: { type: String, default: null },
    lifePurpose: { type: String, default: null },
    questions: { type: String, default: null },
    questionsSeen: { type: Boolean, default: false },
    subreddits: [{ 
      name: { type: String, trim: true },
      percentage: { type: Number, min: 0, max: 100 }
    }],
  },
  {
    timestamps: true,
  }
);

const Roast = mongoose.model("Roast", roastSchema);

export default Roast;
