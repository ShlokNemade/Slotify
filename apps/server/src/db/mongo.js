import { MongoClient } from 'mongodb';
import { config } from '../config/index.js';

let client = null;
let db = null;

/**
 * Connect to MongoDB and initialize collections and indexes.
 * @param {string} [uri] Optional URI override for testing.
 * @returns {Promise<{ client: MongoClient, db: import('mongodb').Db }>}
 */
export async function connectMongo(uri = config.MONGODB_URI) {
  if (client && db) {
    return { client, db };
  }

  client = new MongoClient(uri, {
    maxPoolSize: 50,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  db = client.db();

  await initializeIndexes(db);
  return { client, db };
}

/**
 * Returns the active MongoDB database instance.
 * @returns {import('mongodb').Db}
 */
export function getDb() {
  if (!db) {
    throw new Error('Database is not connected. Call connectMongo() first.');
  }
  return db;
}

/**
 * Returns the active MongoClient instance.
 * @returns {MongoClient}
 */
export function getClient() {
  if (!client) {
    throw new Error('MongoClient is not connected. Call connectMongo() first.');
  }
  return client;
}

/**
 * Close MongoDB connection gracefully.
 */
export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/**
 * Initialize all critical uniqueness, tenant, and operational indexes.
 * @param {import('mongodb').Db} database
 */
export async function initializeIndexes(database) {
  // 1. Users
  await database
    .collection('users')
    .createIndex({ email: 1 }, { unique: true, name: 'uniq_user_email' });

  // 2. Sessions
  await database
    .collection('sessions')
    .createIndex({ sessionTokenHash: 1 }, { unique: true, name: 'uniq_session_token_hash' });
  await database
    .collection('sessions')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_session_expiry' });

  // 3. Businesses
  await database
    .collection('businesses')
    .createIndex({ slug: 1 }, { unique: true, name: 'uniq_business_slug' });
  await database
    .collection('businesses')
    .createIndex({ ownerId: 1 }, { name: 'idx_business_owner' });

  // 4. Services
  await database
    .collection('services')
    .createIndex({ businessId: 1, active: 1 }, { name: 'idx_services_business_active' });

  // 5. Staff
  await database
    .collection('staff')
    .createIndex({ businessId: 1, active: 1 }, { name: 'idx_staff_business_active' });

  // 6. Bookings
  await database
    .collection('bookings')
    .createIndex(
      { businessId: 1, idempotencyKey: 1 },
      { unique: true, name: 'uniq_booking_idempotency' }
    );
  await database
    .collection('bookings')
    .createIndex(
      { businessId: 1, status: 1, startTime: 1 },
      { name: 'idx_bookings_business_status_time' }
    );
  await database
    .collection('bookings')
    .createIndex({ customerId: 1, startTime: 1 }, { name: 'idx_bookings_customer_time' });
  await database
    .collection('bookings')
    .createIndex(
      { 'segments.staffId': 1, 'segments.startTime': 1 },
      { name: 'idx_bookings_segment_staff_time' }
    );

  // 7. Outbox
  await database
    .collection('outbox')
    .createIndex({ status: 1, attempts: 1, createdAt: 1 }, { name: 'idx_outbox_processing' });

  // 8. Audit Events
  await database
    .collection('audit_events')
    .createIndex({ businessId: 1, timestamp: -1 }, { name: 'idx_audit_business_time' });

  // 9. Restrictions
  await database
    .collection('restrictions')
    .createIndex({ businessId: 1, customerId: 1, status: 1 }, { name: 'idx_restrictions_lookup' });

  // 10. Availability exceptions (tenant-scoped; date + staff lookups)
  await database
    .collection('availability_exceptions')
    .createIndex(
      { businessId: 1, date: 1 },
      { name: 'idx_exceptions_business_date' }
    );
  await database
    .collection('availability_exceptions')
    .createIndex(
      { businessId: 1, staffId: 1 },
      { name: 'idx_exceptions_business_staff' }
    );
  await database
    .collection('availability_exceptions')
    .createIndex(
      { businessId: 1, serviceId: 1 },
      { name: 'idx_exceptions_business_service' }
    );
}
