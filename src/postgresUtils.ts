/* eslint-disable @typescript-eslint/no-explicit-any */
import { customType, timestamp } from 'drizzle-orm/pg-core'

export const timestamps: { createdAt: any; updatedAt: any } = {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
        .defaultNow()
        .$onUpdate(() => new Date())
        .notNull(),
}

export const expiringTimestamp: any = customType<{
    data: Date
    driverData: string
    configRequired: true
    config: { expireAfterSeconds: number }
}>({
    dataType() {
        return `timestamp`
    },
    fromDriver(value: string): Date {
        return new Date(value)
    },
})
