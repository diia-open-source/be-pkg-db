import { model } from 'mongoose'

import { DiiaLogger } from '@diia-inhouse/diia-logger'
import { Histogram } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'

import { DatabaseAdapterType, DbType, MongodbOperationResult } from '../../src/interfaces'
import { counterSchema } from '../../src/schemas/counter'
import { DatabaseService } from '../../src/services/database'
import { generateIdentifier } from '../mocks/randomData'
import { getConfig } from '../utils'

const databaseAdapter = process.env.DATABASE_ADAPTER as DatabaseAdapterType
const counterModel = model('Counter', counterSchema)

// Command monitoring is set when the main mongoose connection opens, so these tests cannot share a file with ones that open it without metrics.
describe.runIf(databaseAdapter === 'mongo')('Database metrics', () => {
    const config = getConfig()
    const logger = new DiiaLogger()
    const envService = new EnvService(logger)
    const mainConfig = config.db[DbType.Main]
    const db = new DatabaseService('mongo', { [DbType.Main]: { ...mainConfig, metrics: { enabled: true } } }, envService, logger)

    beforeAll(async () => {
        await db.onInit()
        await counterModel.init()
    })

    afterAll(async () => {
        await db.onDestroy()
    })

    it('should record the duration of a succeeded command by database, collection and operation', async () => {
        // Arrange
        const observeSpy = vi.spyOn(Histogram.prototype, 'observe')

        // Act
        await counterModel.find({ code: generateIdentifier() })

        // Assert
        expect(observeSpy).toHaveBeenCalledWith(
            { operation: 'find', status: MongodbOperationResult.Successful, database: mainConfig.database, collection: 'counters' },
            expect.any(Number),
        )
    })

    it('should record the duration of a failed command by database, collection and operation', async () => {
        // Arrange
        const observeSpy = vi.spyOn(Histogram.prototype, 'observe')

        // Act
        const aggregatePromise = counterModel.collection.aggregate([{ $unknownStage: {} }]).toArray()

        // Assert
        await expect(aggregatePromise).rejects.toThrow('$unknownStage')
        expect(observeSpy).toHaveBeenCalledWith(
            { operation: 'aggregate', status: MongodbOperationResult.Failed, database: mainConfig.database, collection: 'counters' },
            expect.any(Number),
        )
    })
})
