import { mongo } from 'mongoose'

import { AuthService } from '@diia-inhouse/crypto'
import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { DurationMs } from '@diia-inhouse/types'

import { EncryptedStorage } from '../../src/interfaces/models/encryptedStorage'
import encryptedStorageModel from '../../src/models/encryptedStorage'
import { DatabaseService } from '../../src/services/database'
import { EncryptedStorageService } from '../../src/services/encryptedStorage'
import { getConfig } from '../utils'

const config = getConfig()
const logger = new DiiaLogger()
const envService = new EnvService(logger)

async function getEncryptedStorage(): Promise<EncryptedStorageService> {
    const authService = new AuthService(config.authConfig, logger)

    await authService.onInit()

    return new EncryptedStorageService(logger, authService, envService)
}

describe('encrypted storage', () => {
    beforeEach(async () => {
        const db = new DatabaseService(config.db, envService, logger)

        await db.onInit()
    })

    it('save method should return ObjectId and store data', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const mockData = Date.now()

        jest.spyOn(global.Date, 'now').mockImplementation(() => mockData)

        // Act
        const resultObjectId = await encryptedStorage.save({ data: 1 }, DurationMs.Day)

        // Assert
        const data = await encryptedStorageModel.findOne({ _id: resultObjectId }).lean()

        expect(data).toMatchObject<EncryptedStorage>({
            expiresAt: new Date(mockData + DurationMs.Day),
            data: expect.any(String),
        })
    })

    it('should set source field in a stage env', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const mockData = Date.now()

        jest.spyOn(global.Date, 'now').mockImplementation(() => mockData)
        jest.spyOn(envService, 'isStage').mockImplementationOnce(() => true)

        const testData = { data: 1 }

        // Act
        const resultObjectId = await encryptedStorage.save(testData, DurationMs.Day)

        // Assert
        const data = await encryptedStorageModel.findOne({ _id: resultObjectId }).lean()

        expect(data).toMatchObject<EncryptedStorage>({
            expiresAt: new Date(mockData + DurationMs.Day),
            data: expect.any(String),
            source: expect.objectContaining(testData),
        })
    })

    it('getSafe method should return undefined if error caused', async () => {
        // Arrange
        const encryptedStorage = await getEncryptedStorage()

        const getMock = jest.spyOn(encryptedStorage, 'get').mockImplementation(async () => {
            throw new Error('error')
        })

        // Act
        const resultObjectId = await encryptedStorage.getSafe(new mongo.ObjectId())

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

        const { _id: id } = await encryptedStorageModel.create(mockData)

        const mockDate = Date.now()

        jest.spyOn(global.Date, 'now').mockImplementation(() => mockDate)

        // Act
        await encryptedStorage.setExpiration(id, DurationMs.Day * 2)

        // Assert
        const data = await encryptedStorageModel.findOne({ _id: id })

        expect(data).toMatchObject({
            data: expect.any(String),
            expiresAt: new Date(mockDate + DurationMs.Day * 2),
        })
    })

    it('getExpiration method should return expiration time', async () => {
        // Arrange
        const mockDate = Date.now()

        jest.spyOn(global.Date, 'now').mockImplementation(() => mockDate)

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

        const mockData = [
            {
                data: 'eyJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwiYWxnIjoiUlNBLU9BRVAiLCJraWQiOiI2MDdSRnNocUx5Rk5oMWhLR193RkdKdmZmVXl1dVVuR01yanE3U1p1ajBRIn0',
                expiresAt: new Date(Date.now() + DurationMs.Day),
            },
            {
                data: 'eyJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwiYWxnIjoiUlNBLU9BRVAiLCJraWQiOiI2MDdSRnNocUx5Rk5oMWhLR193RkdKdmZmVXl1dVVuR01yanE3U1p1ajBRIn0',
                expiresAt: new Date(Date.now() + DurationMs.Day),
            },
        ]

        const documents = await Promise.all(mockData.map((mockItem) => encryptedStorageModel.create(mockItem)))

        // Act
        const ids = documents.map((doc) => doc._id)

        await encryptedStorage.deleteMany(ids)

        // Assert
        const isItemsExists = await Promise.all(ids.map((id) => encryptedStorageModel.exists({ _id: id })))
        const assertResult = isItemsExists.every((isExists) => !isExists)

        expect(assertResult).toBeTruthy()
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
        const data = await encryptedStorageModel.findOne({ _id: dataId })

        expect(data).toMatchObject({
            data: expect.any(String),
            expiresAt: expect.any(Date),
        })

        expect(rawData).toMatchObject(packageData)
    })
})
