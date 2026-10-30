import nodemailer from 'nodemailer';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { config } from '../config/index.js';
import { BookingStatus, OutboxEventType, OutboxStatus } from '@slotify/shared';

const MAX_ATTEMPTS = 3;

function messageFor(event, _user) {
  if (event.eventType === OutboxEventType.BOOKING_CONFIRMED) {
    return {
      title: 'Booking confirmed',
      message: 'Your appointment has been confirmed.',
      subject: 'Your Slotify booking is confirmed',
    };
  }
  if (event.eventType === OutboxEventType.BOOKING_CANCELLED) {
    return {
      title: 'Booking cancelled',
      message: 'Your appointment was cancelled.',
      subject: 'Your Slotify booking was cancelled',
    };
  }
  if (event.eventType === OutboxEventType.USER_VERIFICATION_REQUESTED) {
    return {
      title: 'Verify your email',
      message: 'Your Slotify account is ready. Verify your email to continue.',
      subject: 'Verify your Slotify account',
    };
  }
  if (event.eventType === OutboxEventType.PASSWORD_RESET_REQUESTED) {
    return {
      title: 'Password reset requested',
      message: 'A password reset was requested for your Slotify account.',
      subject: 'Reset your Slotify password',
    };
  }
  throw new Error(`Unsupported notification event type: ${event.eventType}`);
}

function recipientFor(event) {
  return event.payload?.userId ?? event.payload?.customerId ?? event.payload?.ownerId;
}

async function bookingEventIsCurrent(event) {
  if (
    event.eventType !== OutboxEventType.BOOKING_CONFIRMED &&
    event.eventType !== OutboxEventType.BOOKING_CANCELLED
  ) {
    return true;
  }
  if (!event.payload?.bookingId || !ObjectId.isValid(event.payload.bookingId)) return false;
  const booking = await getDb().collection('bookings').findOne({
    _id: new ObjectId(event.payload.bookingId),
  });
  const expectedStatus =
    event.eventType === OutboxEventType.BOOKING_CONFIRMED
      ? BookingStatus.CONFIRMED
      : BookingStatus.CANCELLED;
  return booking?.status === expectedStatus;
}

async function claimNextEvent() {
  const now = new Date();
  return getDb().collection('outbox').findOneAndUpdate(
    {
      status: OutboxStatus.PENDING,
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
    },
    {
      $set: { status: 'processing', processingStartedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  );
}

async function processEvent(event, transporter) {
  const db = getDb();
  if (!(await bookingEventIsCurrent(event))) {
    await db.collection('outbox').updateOne(
      { _id: event._id, status: 'processing' },
      { $set: { status: OutboxStatus.PUBLISHED, publishedAt: new Date() }, $unset: { processingStartedAt: '' } }
    );
    return;
  }
  const recipientId = recipientFor(event);
  const recipient = recipientId
    ? ObjectId.isValid(recipientId)
      ? await db.collection('users').findOne({ _id: new ObjectId(recipientId) })
      : null
    : null;
  const content = messageFor(event, recipient);

  if (recipient) {
    await db.collection('notifications').updateOne(
      { userId: recipient._id, sourceEventId: event._id },
      {
        $setOnInsert: {
          userId: recipient._id,
          sourceEventId: event._id,
          type: event.eventType,
          title: content.title,
          message: content.message,
          readAt: null,
          emailSentAt: null,
          createdAt: event.createdAt,
        },
      },
      { upsert: true }
    );
    const notification = await db.collection('notifications').findOne({
      userId: recipient._id,
      sourceEventId: event._id,
    });
    if (!notification.emailSentAt) {
      await transporter.sendMail({
        from: config.SMTP_FROM,
        to: recipient.email,
        subject: content.subject,
        text: content.message,
      });
      await db.collection('notifications').updateOne(
        { _id: notification._id, emailSentAt: null },
        { $set: { emailSentAt: new Date() } }
      );
    }
  }

  await db.collection('outbox').updateOne(
    { _id: event._id, status: 'processing' },
    { $set: { status: OutboxStatus.PUBLISHED, publishedAt: new Date() }, $unset: { processingStartedAt: '' } }
  );
}

export async function processOneNotification() {
  const event = await claimNextEvent();
  if (!event) return false;
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
  });
  try {
    await processEvent(event, transporter);
  } catch (error) {
    const attempts = event.attempts ?? 1;
    await getDb().collection('outbox').updateOne(
      { _id: event._id, status: 'processing' },
      {
        $set: {
          status: attempts >= MAX_ATTEMPTS ? OutboxStatus.FAILED : OutboxStatus.PENDING,
          nextAttemptAt: new Date(Date.now() + attempts * 60_000),
          lastError: error instanceof Error ? error.message : String(error),
        },
        $unset: { processingStartedAt: '' },
      }
    );
  }
  return true;
}

export async function runNotificationWorker({ intervalMs = 1000, signal } = {}) {
  while (!signal?.aborted) {
    const processed = await processOneNotification();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
