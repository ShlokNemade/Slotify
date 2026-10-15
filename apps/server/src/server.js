import { createApp } from './app.js';
import { connectMongo, closeMongo } from './db/mongo.js';
import { config } from './config/index.js';

async function bootstrap() {
  console.log('Connecting to MongoDB...');
  await connectMongo();
  console.log('Connected to MongoDB successfully with replica set and indexes initialized.');

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`Slotify API Server listening on port ${config.PORT} [${config.NODE_ENV}]`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      console.log('HTTP server closed.');
      await closeMongo();
      console.log('MongoDB connection closed.');
      process.exit(0);
    });

    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      console.error('Forcefully terminating process after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap failure:', err);
  process.exit(1);
});
