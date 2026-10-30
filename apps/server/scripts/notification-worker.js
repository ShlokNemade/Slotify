import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { runNotificationWorker } from '../src/workers/notification-worker.js';

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());

try {
  await connectMongo();
  await runNotificationWorker({ signal: controller.signal });
} finally {
  await closeMongo();
}
