import { Router } from 'express';
import { getDb } from '../db/mongo.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

healthRouter.get('/ready', async (_req, res) => {
  try {
    const db = getDb();
    const pingResult = await db.command({ ping: 1 });
    const isMongoOk = pingResult.ok === 1;

    if (!isMongoOk) {
      return res.status(503).json({
        status: 'unready',
        database: 'unresponsive',
      });
    }

    res.status(200).json({
      status: 'ready',
      database: 'connected',
      uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unready',
      error: error.message,
    });
  }
});
