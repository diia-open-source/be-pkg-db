import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { DateTime } from 'luxon'
import { model } from 'mongoose'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'

import { DatabaseAdapterType } from '../../src/interfaces/database'
import { counterSchema } from '../../src/schemas/counter'
import { CounterService } from '../../src/services/counter'
import { DatabaseService } from '../../src/services/database'
import * as schema from '../../src/tables'
import { getConfig } from '../utils'

const config = getConfig()
const logger = new DiiaLogger()
const envService = new EnvService(logger)
const counterModel = model('Counter', counterSchema)
const databaseAdapter = process.env.DATABASE_ADAPTER as DatabaseAdapterType
const postgresDatabase = drizzle(process.env.POSTGRES_DATABASE_URL!, { casing: 'snake_case', schema, logger: true })

function getCounterService(): CounterService {
    return new CounterService(databaseAdapter, counterModel, postgresDatabase)
}

async function updateCounter(code: string): Promise<void> {
    if (databaseAdapter === 'mongo') {
        await counterModel.updateOne({ code }, { date: DateTime.now().startOf('day').minus({ days: 1 }).toJSDate() })

        return
    }

    await postgresDatabase
        .update(schema.counter)
        .set({ date: DateTime.now().startOf('day').minus({ days: 1 }).toJSDate() })
        .where(eq(schema.counter.code, code))
}

describe('Counter service', () => {
    beforeAll(async () => {
        if (databaseAdapter === 'mongo') {
            const db = new DatabaseService('mongo', config.db, envService, logger)

            await db.onInit()
        }
    })

    const counterName1 = randomUUID()
    const counterName2 = randomUUID()
    const counterName3 = randomUUID()

    it.each([1, 2, 3, 4, 5])('should successfully create new and increment existing counter', async (expectedCounter) => {
        const counterService = getCounterService()

        expect(await counterService.getNextValue(counterName1)).toBe(expectedCounter)
    })

    it.each([1, 2, 3, 4, 5])('should successfully create new and increment existing daily counter', async (expectedCounter) => {
        const counterService = getCounterService()

        expect(await counterService.getNextDailyValue(counterName2)).toBe(expectedCounter)
    })

    it('should successfully create new daily counter in case counter exists on next day', async () => {
        const counterService = getCounterService()

        expect(await counterService.getNextDailyValue(counterName3)).toBe(1)
        expect(await counterService.getNextDailyValue(counterName3)).toBe(2)

        await updateCounter(counterName3)

        expect(await counterService.getNextDailyValue(counterName3)).toBe(1)
    })
})
