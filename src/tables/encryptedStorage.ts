/* eslint-disable @typescript-eslint/no-explicit-any */
import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { DurationS } from '@diia-inhouse/types'

import { expiringTimestamp, timestamps } from '../postgresUtils.js'

export const encryptedStorage: any = pgTable('encrypted_storage', {
    id: uuid('id').primaryKey().defaultRandom(),
    data: text('data').notNull(),
    expiresAt: expiringTimestamp('expires_at', { expireAfterSeconds: DurationS.Day }).notNull(),
    source: jsonb('source'),
    ...timestamps,
})
