import { sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { Model } from 'mongoose'

import { DatabaseAdapterType, PostgresDatabase } from '../interfaces'
import { Counter } from '../interfaces/models/counter'
import { counter } from '../tables'

export class CounterService {
    private readonly getNextValueStrategy: Record<DatabaseAdapterType, (code: string) => Promise<number>> = {
        postgres: async (code: string): Promise<number> => {
            const result = await this.getPostgresDatabase()
                .insert(counter)
                .values({ code, value: 1, date: DateTime.now().startOf('day').toJSDate() })
                .onConflictDoUpdate({
                    target: [counter.code, counter.date],
                    set: { value: sql`${counter.value} + 1` },
                })
                .returning()
                .then((rows) => rows[0])

            return result.value
        },
        mongo: async (code: string): Promise<number> => {
            const result = await this.getModel().findOneAndUpdate({ code }, { $inc: { value: 1 } }, { new: true, upsert: true })

            return result.value
        },
    }

    private readonly getNextDailyValueStrategy: Record<DatabaseAdapterType, (code: string) => Promise<number>> = {
        postgres: async (code: string): Promise<number> => {
            const result = await this.getPostgresDatabase()
                .insert(counter)
                .values({ code, value: 1, date: DateTime.now().startOf('day').toJSDate() })
                .onConflictDoUpdate({
                    target: [counter.code, counter.date],
                    set: { value: sql`${counter.value} + 1` },
                })
                .returning()
                .then((rows) => rows[0])

            return result.value
        },
        mongo: async (code: string): Promise<number> => {
            const result = await this.getModel().findOneAndUpdate(
                { code, date: DateTime.now().startOf('day').toJSDate() },
                { $inc: { value: 1 } },
                { new: true, upsert: true },
            )

            return result.value
        },
    }

    constructor(
        private readonly databaseAdapter: DatabaseAdapterType,
        private readonly counterModel: Model<Counter> | null = null,
        private readonly postgresDatabase: PostgresDatabase | null = null,
    ) {}

    async getNextValue(code: string): Promise<number> {
        return await this.getNextValueStrategy[this.databaseAdapter](code)
    }

    async getNextDailyValue(code: string): Promise<number> {
        return await this.getNextDailyValueStrategy[this.databaseAdapter](code)
    }

    private getModel(): Model<Counter> {
        if (!this.counterModel) {
            throw new Error('Counter model is not provided')
        }

        return this.counterModel
    }

    private getPostgresDatabase(): PostgresDatabase {
        if (!this.postgresDatabase) {
            throw new Error('Postgres database is not provided')
        }

        return this.postgresDatabase
    }
}
