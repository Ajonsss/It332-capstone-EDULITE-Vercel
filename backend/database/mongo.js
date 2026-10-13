import mongoose from "mongoose";

mongoose.set("bufferCommands", false);
mongoose.set("autoCreate", false);
mongoose.set("autoIndex", false);

let connectionPromise;

export async function connectMongoDatabase() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error(
      "MONGODB_URI is missing from the environment.",
    );
  }

  if (
    mongoose.connection.readyState === 1 &&
    mongoose.connection.db
  ) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    // Share an in-flight connection instead of disconnecting another request.
    connectionPromise = mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    }).finally(() => {
      connectionPromise = undefined;
    });
  }

  await connectionPromise;

  if (
    mongoose.connection.readyState !== 1 ||
    !mongoose.connection.db
  ) {
    throw new Error(
      "Mongoose did not finish opening the MongoDB database.",
    );
  }

  console.log(
    "EduLITE successfully connected to MongoDB Atlas.",
  );

  return mongoose.connection;
}

export async function disconnectMongoDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export default mongoose;
