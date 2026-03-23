import { QueryOptions, model, mongo } from 'mongoose'
import { mock } from 'vitest-mock-extended'

import { AuthService } from '@diia-inhouse/crypto'
import Logger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { NotFoundError } from '@diia-inhouse/errors'
import { utils } from '@diia-inhouse/utils'

import { DatabaseAdapterType } from '../../../src/interfaces/database'
import { encryptedStorageSchema } from '../../../src/schemas/encryptedStorage'
import { EncryptedStorageService } from '../../../src/services'
import { generateIdentifier } from '../../mocks/randomData'

vi.mock('@diia-inhouse/utils', () => ({ utils: { decodeObjectFromBase64: vi.fn(), encodeObjectToBase64: vi.fn() } }))

describe('EncryptedStorageService', () => {
    const logger = mock<Logger>()
    const auth = mock<AuthService>()
    const envService = mock<EnvService>()
    const encryptedStorageModel = model('EncryptedStorage', encryptedStorageSchema)
    const databaseAdapter = 'mongo' satisfies DatabaseAdapterType
    const encryptedStorageService = new EncryptedStorageService(logger, auth, envService, databaseAdapter, encryptedStorageModel)

    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('method: `save`', () => {
        it('should successfully save data into encrypted storage', async () => {
            const id = new mongo.ObjectId()
            const data = new encryptedStorageModel({ _id: id })
            const encodedData = Buffer.from('data').toString('base64')
            const expiration = 1000

            vi.mocked(utils.encodeObjectToBase64).mockReturnValueOnce(encodedData)
            vi.mocked(auth.encryptJWE).mockResolvedValueOnce(encodedData)
            vi.mocked(envService.isStage).mockReturnValue(true)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn(encryptedStorageModel, 'create').mockResolvedValueOnce(data as any)

            expect(await encryptedStorageService.save('data', expiration)).toEqual(id.toString())
            expect(encryptedStorageModel.create).toHaveBeenCalledWith({
                data: encodedData,
                expiresAt: new Date(Date.now() + expiration),
                source: 'data',
            })
        })
    })

    describe('method: `get`', () => {
        it('should successfully get data from encrypted storage', async () => {
            const id = generateIdentifier()
            const expectedData = '{}'
            const encodedData = Buffer.from(Buffer.from(expectedData).toString('base64'), 'base64').toString()

            vi.spyOn(encryptedStorageModel, 'findById').mockResolvedValueOnce({ data: encodedData })
            auth.decryptJWE.mockResolvedValueOnce(encodedData)
            vi.mocked(utils.decodeObjectFromBase64).mockReturnValueOnce(expectedData)

            expect(await encryptedStorageService.get(id)).toEqual(expectedData)
            expect(encryptedStorageModel.findById).toHaveBeenCalledWith(id, undefined, {})
            expect(auth.decryptJWE).toHaveBeenCalledWith(encodedData)
            expect(utils.decodeObjectFromBase64).toHaveBeenCalledWith(encodedData)
        })

        it('should successfully get data from encrypted storage with options', async () => {
            const id = generateIdentifier()
            const expectedData = '{}'
            const encodedData = Buffer.from(Buffer.from(expectedData).toString('base64'), 'base64').toString()
            const queryOptions: QueryOptions = { readPreference: mongo.ReadPreferenceMode.primaryPreferred }

            vi.spyOn(encryptedStorageModel, 'findById').mockResolvedValueOnce({ data: encodedData })
            auth.decryptJWE.mockResolvedValueOnce(encodedData)
            vi.mocked(utils.decodeObjectFromBase64).mockReturnValueOnce(expectedData)

            expect(await encryptedStorageService.get(id, queryOptions)).toEqual(expectedData)
            expect(encryptedStorageModel.findById).toHaveBeenCalledWith(id, undefined, queryOptions)
            expect(auth.decryptJWE).toHaveBeenCalledWith(encodedData)
            expect(utils.decodeObjectFromBase64).toHaveBeenCalledWith(encodedData)
        })
    })

    describe('method: `getSafe`', () => {
        it('should safely get data from encrypted storage', async () => {
            const id = generateIdentifier()
            const expectedData = '{}'
            const encodedData = Buffer.from(Buffer.from(expectedData).toString('base64'), 'base64').toString()

            vi.spyOn(encryptedStorageModel, 'findById').mockResolvedValueOnce({ data: encodedData })
            auth.decryptJWE.mockResolvedValueOnce(encodedData)
            vi.mocked(utils.decodeObjectFromBase64).mockReturnValueOnce(expectedData)

            expect(await encryptedStorageService.getSafe(id)).toEqual(expectedData)
            expect(encryptedStorageModel.findById).toHaveBeenCalledWith(id, undefined, {})
            expect(auth.decryptJWE).toHaveBeenCalledWith(encodedData)
            expect(utils.decodeObjectFromBase64).toHaveBeenCalledWith(encodedData)
        })

        it('should return undefined instead of throwing error when dat is missing', async () => {
            const id = generateIdentifier()
            const expectedError = new NotFoundError('Missing data')

            vi.spyOn(encryptedStorageModel, 'findById').mockResolvedValueOnce(null)

            expect(await encryptedStorageService.getSafe(id)).toBeUndefined()
            expect(encryptedStorageModel.findById).toHaveBeenCalledWith(id, undefined, {})
            expect(logger.error).toHaveBeenCalledWith('Encrypted data is not found in storage', { id })
            expect(logger.log).toHaveBeenCalledWith('Unable to retrieve data from encrypted storage', { err: expectedError })
        })
    })

    describe('method: `update`', () => {
        it('should successfully update data in encrypted storage', async () => {
            const id = generateIdentifier()
            const encodedData = Buffer.from('updated-data').toString('base64')
            const storedData = { save: vi.fn() }

            vi.mocked(utils.encodeObjectToBase64).mockReturnValueOnce(encodedData)
            vi.mocked(auth.encryptJWE).mockResolvedValueOnce(encodedData)
            vi.mocked(envService.isStage).mockReturnValue(true)
            vi.spyOn(encryptedStorageModel, 'findById').mockResolvedValueOnce(storedData)
            vi.spyOn(encryptedStorageModel, 'findByIdAndUpdate').mockResolvedValueOnce(storedData)

            expect(await encryptedStorageService.update(id.toString(), 'updated-data')).toBeUndefined()
            expect(encryptedStorageModel.findByIdAndUpdate).toHaveBeenCalled()
            expect(storedData).toEqual({ ...storedData, data: encodedData, source: 'updated-data' })
        })
    })

    describe('method: `remove`', () => {
        it('successfully remove encrypted data from storage', async () => {
            const id = generateIdentifier()
            const storedData = { save: vi.fn() }

            vi.spyOn(encryptedStorageModel, 'findOneAndDelete').mockResolvedValueOnce(storedData)

            expect(await encryptedStorageService.remove(id.toString())).toBeUndefined()
            expect(encryptedStorageModel.findOneAndDelete).toHaveBeenCalledWith({ _id: id })
            expect(logger.info).toHaveBeenCalledWith('Encrypted data removed from storage', { id })
        })

        it('should not fail with error in case there is nothing to remove', async () => {
            const id = generateIdentifier()

            vi.spyOn(encryptedStorageModel, 'findOneAndDelete').mockResolvedValueOnce(null)

            expect(await encryptedStorageService.remove(id.toString())).toBeUndefined()
            expect(encryptedStorageModel.findOneAndDelete).toHaveBeenCalledWith({ _id: id })
            expect(logger.info).toHaveBeenCalledWith('Encrypted data is not removed from storage: data not found', { id })
        })
    })

    describe('method: `deleteMany`', () => {
        it('should successfully delete meny items per request', async () => {
            const ids = [generateIdentifier()]
            const res = { deletedCount: 1, acknowledged: true }

            vi.spyOn(encryptedStorageModel, 'deleteMany').mockResolvedValueOnce(res)

            expect(await encryptedStorageService.deleteMany(ids.map((id) => id.toString()))).toBeUndefined()
            expect(logger.info).toHaveBeenCalledWith(`Encrypted data removed from storage: ${res.deletedCount}`)
        })
    })

    describe('method: `setExpiration`', () => {
        it('should successfully set expiration', async () => {
            const id = generateIdentifier()
            const expiration = 10000
            const existingExpiresAt = new Date()

            vi.spyOn(encryptedStorageModel, 'findById').mockResolvedValueOnce({ expiresAt: existingExpiresAt })
            vi.spyOn(encryptedStorageModel, 'findByIdAndUpdate').mockResolvedValueOnce(null)

            expect(await encryptedStorageService.setExpiration(id.toString(), expiration)).toBeUndefined()
            expect(logger.info).toHaveBeenCalledWith('Updated encrypted data expiration date', { id })
            expect(encryptedStorageModel.findByIdAndUpdate).toHaveBeenCalledWith(id.toString(), {
                expiresAt: new Date(Date.now() + expiration),
            })
        })

        it('should throw NotFoundError when entity is not found', async () => {
            const id = generateIdentifier()
            const expiration = 10000

            vi.spyOn(encryptedStorageModel, 'findById').mockResolvedValueOnce(null)

            await expect(encryptedStorageService.setExpiration(id.toString(), expiration)).rejects.toThrow(NotFoundError)
            expect(logger.error).toHaveBeenCalledWith('Encrypted data is not found in storage', { id })
        })
    })
})
