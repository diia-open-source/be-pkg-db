import { randomUUID } from 'node:crypto'

import { DateTime } from 'luxon'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'

import counterModel from '../../src/models/counter'
import { CounterService } from '../../src/services/counter'
import { DatabaseService } from '../../src/services/database'
import { getConfig } from '../utils'

const config = getConfig()
const logger = new DiiaLogger()
const envService = new EnvService(logger)

function getCounterService(): CounterService {
    return new CounterService()
}

describe('Counter service', () => {
    beforeAll(async () => {
        const db = new DatabaseService(config.db, envService, logger)

        await db.onInit()
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

        await counterModel.updateOne({ code: counterName3 }, { date: DateTime.now().startOf('day').minus({ days: 1 }).toJSDate() })

        expect(await counterService.getNextDailyValue(counterName3)).toBe(1)
    })
})
