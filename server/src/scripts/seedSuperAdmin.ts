import { connectDB, disconnectDB } from '../database/connect';
import { env } from '../config/env';
import { seedSuperAdmin } from '../services/seedSuperAdmin.service';

async function run(): Promise<void> {
    await connectDB(env.MONGODB_URI);
    const result = await seedSuperAdmin();
    console.log(result.created ? 'Super Admin created.' : 'Super Admin already exists, no changes made.');
    await disconnectDB();
}

run().catch((err) => {
    console.error('Failed to seed Super Admin', err);
    process.exit(1);
});
