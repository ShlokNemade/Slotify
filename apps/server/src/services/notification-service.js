import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { NotFoundError } from '../errors/index.js';

const NOTIFICATIONS_COLLECTION = 'notifications';

export function toNotificationResponse(doc) {
  return {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    readAt: doc.readAt ?? null,
    createdAt: doc.createdAt,
  };
}

export async function listNotifications(userId, { unreadOnly = false } = {}) {
  const filter = { userId: new ObjectId(userId) };
  if (unreadOnly) filter.readAt = null;
  const docs = await getDb()
    .collection(NOTIFICATIONS_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return {
    notifications: docs.map(toNotificationResponse),
    unreadCount: await getDb().collection(NOTIFICATIONS_COLLECTION).countDocuments({
      userId: new ObjectId(userId),
      readAt: null,
    }),
  };
}

export async function markNotificationRead(userId, notificationId) {
  let id;
  try {
    id = new ObjectId(notificationId);
  } catch {
    throw new NotFoundError('Notification not found');
  }
  const result = await getDb().collection(NOTIFICATIONS_COLLECTION).findOneAndUpdate(
    { _id: id, userId: new ObjectId(userId) },
    { $set: { readAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!result) throw new NotFoundError('Notification not found');
  return { notification: toNotificationResponse(result) };
}

export async function markAllNotificationsRead(userId) {
  const result = await getDb().collection(NOTIFICATIONS_COLLECTION).updateMany(
    { userId: new ObjectId(userId), readAt: null },
    { $set: { readAt: new Date() } }
  );
  return { updated: result.modifiedCount };
}
