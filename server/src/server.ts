import { app } from './app';
import { connectDB } from './database/connect';
import { env } from './config/env';
import { startLifecycleReminderJob } from './jobs/lifecycleReminder.job';
import { startPerformanceReminderJob } from './jobs/performanceReminder.job';
import { startPlanExpiryReminderJob } from './jobs/planExpiryReminder.job';

async function bootstrap(): Promise<void> {
    await connectDB(env.MONGODB_URI);
    // Started here, not in app.ts, so tests (which import app) never schedule them.
    startPlanExpiryReminderJob();
    startLifecycleReminderJob();
    startPerformanceReminderJob();
    app.listen(env.PORT, () => {
        console.log(`Server listening on port ${env.PORT}`);
    });
}

bootstrap().catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
});
