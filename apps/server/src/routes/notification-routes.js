import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notification-service.js';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get('/', async (req, res, next) => {
  try {
    const data = await listNotifications(req.user.id, {
      unreadOnly: req.query.unreadOnly === 'true',
    });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

notificationRouter.post('/read-all', async (req, res, next) => {
  try {
    const data = await markAllNotificationsRead(req.user.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

notificationRouter.post('/:notificationId/read', async (req, res, next) => {
  try {
    const data = await markNotificationRead(req.user.id, req.params.notificationId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
