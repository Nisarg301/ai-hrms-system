import { app } from './app';
import { ollamaClient } from './ai/ollama.client';
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
        if (env.AI_ENABLED) void prepareAssistant();
    });
}

/** Checks Ollama and loads the model into RAM, so the first question doesn't wait for it. Never blocks startup. */
async function prepareAssistant(): Promise<void> {
    const status = await ollamaClient.health();
    if (!status.up) {
        console.warn(`AI: cannot reach Ollama at ${env.OLLAMA_HOST}. Start it with "sudo systemctl start ollama"; the assistant shows as offline until then.`);
        return;
    }
    if (!status.modelAvailable) {
        console.warn(`AI: model "${env.OLLAMA_MODEL}" not found. Run "ollama pull ${env.OLLAMA_MODEL}" (installed: ${status.models.join(', ') || 'none'}).`);
        return;
    }
    await ollamaClient.warmUp().catch((err) => console.warn('AI: warm-up failed', err));
    console.log(`AI ready: ${env.OLLAMA_MODEL} at ${env.OLLAMA_HOST}`);
}

bootstrap().catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
});
