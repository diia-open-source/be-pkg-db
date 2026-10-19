import { ClientSession, model, mongo } from 'mongoose'

import { DiiaLogger } from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { DatabaseError, ErrorType } from '@diia-inhouse/errors'
import { HealthCheckResult, HttpStatusCode } from '@diia-inhouse/types'

import { DatabaseAdapterType, DbConnectionStatus, DbType, MongoDBErrorCode, MongoDbStatus } from '../../src/interfaces'
import { counterSchema } from '../../src/schemas/counter'
import { encryptedStorageSchema } from '../../src/schemas/encryptedStorage'
import { DatabaseService } from '../../src/services/database'
import { dbUtils } from '../mocks/dbUtils.js'
import { generateIdentifier } from '../mocks/randomData'
import { getConfig } from '../utils'

const databaseAdapter = process.env.DATABASE_ADAPTER as DatabaseAdapterType
const counterModel = model('Counter', counterSchema)
const encryptedStorageModel = model('EncryptedStorage', encryptedStorageSchema)

const getMongoServerError = (code: MongoDBErrorCode, errorLabel: string): mongo.MongoServerError =>
    new mongo.MongoServerError({ message: `Mongo error ${code}`, code, errorLabels: [errorLabel] })

describe('Database', () => {
    const config = getConfig()
    const logger = new DiiaLogger()
    const envService = new EnvService(logger)

    it.runIf(databaseAdapter === 'mongo')('should return ok health status when connection is up', async () => {
        // Arrange
        const db = new DatabaseService('mongo', config.db, envService, logger)

        await db.onInit()

        // Act
        const result = await db.onHealthCheck()

        // Assert
        // oxlint-disable-next-line jest/no-standalone-expect
        expect(result).toMatchObject<HealthCheckResult<MongoDbStatus>>({
            status: HttpStatusCode.OK,
            details: { mongodb: { [DbType.Main]: DbConnectionStatus.Connected } },
        })
    })

    describe.runIf(databaseAdapter === 'mongo')('method: `withTransaction`', () => {
        const db = new DatabaseService('mongo', config.db, envService, logger)

        const writeDocuments = async (session: ClientSession, code: string, data: string): Promise<string> => {
            await counterModel.create([{ code, value: 1 }], { session })

            const [encryptedStorage] = await encryptedStorageModel.create([{ data, expiresAt: new Date() }], { session })

            return encryptedStorage.data
        }

        beforeAll(async () => {
            await db.onInit()
            await Promise.all([counterModel.init(), encryptedStorageModel.init()])
        })

        it('should commit transaction when first attempt fails with transient transaction error', async () => {
            // Arrange
            const code = generateIdentifier()
            const data = generateIdentifier()
            const transientError = getMongoServerError(MongoDBErrorCode.WriteConflict, mongo.MongoErrorLabel.TransientTransactionError)
            const createSpy = vi.spyOn(encryptedStorageModel, 'create').mockRejectedValueOnce(transientError)

            // Act
            const result = await db.withTransaction((session) => writeDocuments(session, code, data))

            // Assert
            const counters = await dbUtils().counter.cleanupBy('code', [code])
            const [encryptedStorage] = await dbUtils().encryptedStorage.cleanupBy('data', [data])

            expect(result).toBe(data)
            expect(encryptedStorage.data).toBe(data)
            expect(counters).toHaveLength(1)
            expect(createSpy).toHaveBeenCalledTimes(2)
        })

        it('should fail with database error when transient transaction error repeats on every attempt', async () => {
            // Arrange
            const code = generateIdentifier()
            const data = generateIdentifier()
            const transientError = getMongoServerError(MongoDBErrorCode.WriteConflict, mongo.MongoErrorLabel.TransientTransactionError)
            const createSpy = vi
                .spyOn(encryptedStorageModel, 'create')
                .mockRejectedValueOnce(transientError)
                .mockRejectedValueOnce(transientError)

            // Act
            const resultPromise = db.withTransaction((session) => writeDocuments(session, code, data), { retries: 1 })

            // Assert
            await expect(resultPromise).rejects.toThrow(
                new DatabaseError('Failed to complete transaction. No retries left', {}, undefined, ErrorType.Unoperated),
            )

            const counters = await dbUtils().counter.cleanupBy('code', [code])
            const encryptedStorages = await dbUtils().encryptedStorage.cleanupBy('data', [data])

            expect(createSpy).toHaveBeenCalledTimes(2)
            expect(counters).toEqual([])
            expect(encryptedStorages).toEqual([])
        })

        it('should fail with database error when operation times out', async () => {
            // Arrange
            const code = generateIdentifier()
            const data = generateIdentifier()
            const createSpy = vi
                .spyOn(encryptedStorageModel, 'create')
                .mockRejectedValueOnce(new mongo.MongoOperationTimeoutError('Timed out'))

            // Act
            const resultPromise = db.withTransaction((session) => writeDocuments(session, code, data))

            // Assert
            await expect(resultPromise).rejects.toThrow(
                new DatabaseError('Failed to complete transaction', {}, undefined, ErrorType.Unoperated),
            )

            const counters = await dbUtils().counter.cleanupBy('code', [code])

            expect(createSpy).toHaveBeenCalledTimes(1)
            expect(counters).toEqual([])
        })

        it('should fail with database error when commit result is unknown', async () => {
            // Arrange
            const code = generateIdentifier()
            const data = generateIdentifier()
            const commitError = getMongoServerError(MongoDBErrorCode.MaxTimeMSExpired, mongo.MongoErrorLabel.UnknownTransactionCommitResult)
            const commitSpy = vi.spyOn(mongo.ClientSession.prototype, 'commitTransaction').mockRejectedValueOnce(commitError)

            // Act
            const resultPromise = db.withTransaction((session) => writeDocuments(session, code, data))

            // Assert
            await expect(resultPromise).rejects.toThrow(
                new DatabaseError('Failed to complete transaction', {}, undefined, ErrorType.Unoperated),
            )

            const counters = await dbUtils().counter.cleanupBy('code', [code])
            const encryptedStorages = await dbUtils().encryptedStorage.cleanupBy('data', [data])

            expect(commitSpy).toHaveBeenCalledTimes(1)
            expect(counters).toEqual([])
            expect(encryptedStorages).toEqual([])
        })

        it('should rethrow error without retrying when error is not transient', async () => {
            // Arrange
            const code = generateIdentifier()
            const data = generateIdentifier()
            const error = new Error('Not transient')
            const createSpy = vi.spyOn(encryptedStorageModel, 'create').mockRejectedValueOnce(error)

            // Act
            const resultPromise = db.withTransaction((session) => writeDocuments(session, code, data))

            // Assert
            await expect(resultPromise).rejects.toBe(error)

            const counters = await dbUtils().counter.cleanupBy('code', [code])

            expect(createSpy).toHaveBeenCalledTimes(1)
            expect(counters).toEqual([])
        })
    })
})
