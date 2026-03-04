import { customType, timestamp } from 'drizzle-orm/pg-core'

export const timestamps = {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
        .defaultNow()
        .$onUpdate(() => new Date())
        .notNull(),
}

export const expiringTimestamp = customType<{
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
