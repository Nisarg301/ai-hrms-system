import mongoose from 'mongoose';

export async function connectDB(uri: string): Promise<void> {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri);
}

export async function disconnectDB(): Promise<void> {
    await mongoose.disconnect();
}
