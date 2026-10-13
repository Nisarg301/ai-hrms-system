import { app } from './app';
import { connectDB } from './database/connect';
import { env } from './config/env';


async function bootstrap(): Promise<void> {
    await connectDB(env.MONGODB_URI);
    // Started here, not in app.ts, so tests (which import app) never schedule them.

    app.listen(env.PORT, () => {
        console.log(`Server listening on port ${env.PORT}`);
    });
}

bootstrap().catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
});
