import { drizzle } from 'drizzle-orm/node-postgres'
import { model } from 'mongoose'
import { dbUtils } from 'tests/mocks/dbUtils'

import { AuthService } from '@diia-inhouse/crypto'
import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { DurationMs } from '@diia-inhouse/types'
import { RandomUtils } from '@diia-inhouse/utils'

import { DatabaseAdapterType } from '../../src/interfaces/database'
import { EncryptedStorage } from '../../src/interfaces/models/encryptedStorage'
import { encryptedStorageSchema } from '../../src/schemas/encryptedStorage'
import { DatabaseService } from '../../src/services/database'
import { EncryptedStorageService } from '../../src/services/encryptedStorage'
import * as schema from '../../src/tables'
import { getConfig } from '../utils'

const config = getConfig()
const logger = new DiiaLogger()
const envService = new EnvService(logger)
const encryptedStorageModel = model('EncryptedStorage', encryptedStorageSchema)
const databaseAdapter = process.env.DATABASE_ADAPTER as DatabaseAdapterType

async function getEncryptedStorage(): Promise<EncryptedStorageService> {
    const authService = new AuthService(config.authConfig, logger)

    const postgresDatabase = drizzle(process.env.POSTGRES_DATABASE_URL!, { casing: 'snake_case', schema, logger: true })

    await authService.onInit()

    return new EncryptedStorageService(logger, authService, envService, databaseAdapter, encryptedStorageModel, postgresDatabase)
}

describe('encrypted storage', () => {
    beforeEach(async () => {
        if (databaseAdapter === 'mongo') {
            const db = new DatabaseService('mongo', config.db, envService, logger)

            await db.onInit()
        }
    })

    it('save method should return ObjectId and store data', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const mockData = Date.now()

        vi.spyOn(globalThis.Date, 'now').mockImplementation(() => mockData)

        // Act
        const resultObjectId = await encryptedStorage.save({ data: 1 }, DurationMs.Day)

        // Assert
        const [data] = await dbUtils().encryptedStorage.cleanupBy('id', [resultObjectId as string])

        expect(data).toMatchObject<EncryptedStorage>({
            expiresAt: new Date(mockData + DurationMs.Day),
            data: expect.any(String),
        })
    })

    it('should set source field in a stage env', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const mockData = Date.now()

        vi.spyOn(globalThis.Date, 'now').mockImplementation(() => mockData)
        vi.spyOn(envService, 'isStage').mockImplementationOnce(() => true)

        const testData = { data: 1 }

        // Act
        const resultObjectId = await encryptedStorage.save(testData, DurationMs.Day)

        // Assert
        const [data] = await dbUtils().encryptedStorage.cleanupBy('id', [resultObjectId as string])

        expect(data).toMatchObject<EncryptedStorage>({
            expiresAt: new Date(mockData + DurationMs.Day),
            data: expect.any(String),
            source: expect.objectContaining(testData),
        })
    })

    it('getSafe method should return undefined if error caused', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const getMock = vi.spyOn(encryptedStorage, 'get').mockImplementation(async () => {
            throw new Error('error')
        })

        // Act
        const resultObjectId = await encryptedStorage.getSafe(RandomUtils.generateUUID())

        // Assert
        expect(resultObjectId).toBeUndefined()
        expect(getMock).toHaveBeenCalled()
    })

    it('setExpiration method should update expiresAt field', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const mockData: EncryptedStorage = {
            data: 'eyJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwiYWxnIjoiUlNBLU9BRVAiLCJraWQiOiI2MDdSRnNocUx5Rk5oMWhLR193RkdKdmZmVXl1dVVuR01yanE3U1p1ajBRIn0',
            expiresAt: new Date(Date.now() + DurationMs.Day),
        }

        const { id } = await dbUtils().encryptedStorage.seed.save(mockData)

        const mockDate = Date.now()

        vi.spyOn(globalThis.Date, 'now').mockImplementation(() => mockDate)

        // Act
        await encryptedStorage.setExpiration(id!, DurationMs.Day * 2)

        // Assert
        const [data] = await dbUtils().encryptedStorage.cleanupBy('id', [id])

        expect(data).toMatchObject({
            data: expect.any(String),
            expiresAt: new Date(mockDate + DurationMs.Day * 2),
        })
    })

    it('getExpiration method should return expiration time', async () => {
        // Arrange
        const mockDate = Date.now()

        vi.spyOn(globalThis.Date, 'now').mockImplementation(() => mockDate)

        const encryptedStorage = await getEncryptedStorage()
        const dataId = await encryptedStorage.save({ mockData: true }, DurationMs.Day)

        // Act
        const expiration = await encryptedStorage.getExpiration(dataId)

        // Assert
        expect(expiration).toStrictEqual(new Date(mockDate + DurationMs.Day))
    })

    it('deleteMany method should delete items', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const mockData = {
            data: 'eyJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwiYWxnIjoiUlNBLU9BRVAiLCJraWQiOiI2MDdSRnNocUx5Rk5oMWhLR193RkdKdmZmVXl1dVVuR01yanE3U1p1ajBRIn0',
            expiresAt: new Date(Date.now() + DurationMs.Day),
        }

        const documents = await dbUtils().encryptedStorage.seed.many(2).save(mockData)
        const ids = documents.map((doc) => doc.id).filter((id) => id !== undefined)

        // Act\
        await encryptedStorage.deleteMany(ids)

        // Assert
        const foundItems = await dbUtils().encryptedStorage.cleanupBy('id', ids)

        expect(foundItems).toHaveLength(0)
    })

    it('basic scenario: calling the "save" method should create encrypted data and calling the "get" method should return raw object', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const packageData = {
            someData: true,
        }

        // Act
        const dataId = await encryptedStorage.save(packageData, DurationMs.Day)
        const rawData = await encryptedStorage.get(dataId)

        // Assert
        const [data] = await dbUtils().encryptedStorage.cleanupBy('id', [dataId as string])

        expect(data).toMatchObject({
            data: expect.any(String),
            expiresAt: expect.any(Date),
        })

        expect(rawData).toMatchObject(packageData)
    })
})
