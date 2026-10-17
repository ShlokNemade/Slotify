/**
 * Local/ops bootstrap script: create or reset the platform admin account.
 * Never exposed through public registration (see docs/security.md).
 *
 * Usage:
 *   ADMIN_EMAIL=admin@slotify.internal ADMIN_PASSWORD=<min 12 chars> npm run bootstrap:admin
 *
 * The password must be supplied via environment variables and is never
 * logged or stored in plain text.
 */
import { bootstrapAdmin } from '../src/services/admin-service.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error(
    'Missing ADMIN_EMAIL or ADMIN_PASSWORD environment variables. Nothing was changed.'
  );
  process.exit(1);
}

if (password.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters long. Nothing was changed.');
  process.exit(1);
}

try {
  await connectMongo();
  const result = await bootstrapAdmin({ email, password });
  console.log(
    `Platform admin ${result.created ? 'created' : 'updated'} for ${email} (userId: ${result.adminId})`
  );
} catch (err) {
  console.error('Admin bootstrap failed:', err.message);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
