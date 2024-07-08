import { QueryOptions, Types } from 'mongoose'

import { AuthService } from '@diia-inhouse/crypto'
import { EnvService } from '@diia-inhouse/env'
import { NotFoundError } from '@diia-inhouse/errors'
import { Logger } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import { EncryptedStorage, EncryptedStorageModel } from '../interfaces/models/encryptedStorage'
import encryptedStorageModel from '../models/encryptedStorage'

export class EncryptedStorageService {
    constructor(
        private readonly logger: Logger,
        private readonly auth: AuthService,
        private readonly envService: EnvService,
    ) {}

    async save<T>(data: T, expiration: number): Promise<Types.ObjectId> {
        const encryptedData = await this.auth.encryptJWE(utils.encodeObjectToBase64(data))

        const storageItem: EncryptedStorage = {
            data: encryptedData,
            expiresAt: new Date(Date.now() + expiration),
        }

        if (this.envService.isStage()) {
            storageItem.source = data
        }

        const result = await encryptedStorageModel.create(storageItem)

        return result.id
    }

    async get<T>(id: Types.ObjectId, options: QueryOptions = {}): Promise<T> {
        const storageItem = await this.getStorageItemById(id, options)
        const decryptedData = await this.auth.decryptJWE<string>(storageItem.data)

        return await utils.decodeObjectFromBase64(decryptedData)
    }

    async getSafe<T>(id: Types.ObjectId, options: QueryOptions = {}): Promise<T | undefined> {
        try {
            return await this.get(id, options)
        } catch (err) {
            this.logger.log('Unable to retrieve data from encrypted storage', { err })

            return undefined
        }
    }

    async update<T>(id: Types.ObjectId, data: T): Promise<void> {
        const storageItem = await this.getStorageItemById(id)

        const encryptedData = await this.auth.encryptJWE(utils.encodeObjectToBase64(data))

        storageItem.data = encryptedData

        if (this.envService.isStage()) {
            storageItem.source = data
        }

        await storageItem.save()
    }

    async remove(id: Types.ObjectId): Promise<void> {
        const storageItem = await encryptedStorageModel.findOneAndDelete({ _id: id })
        if (!storageItem) {
            this.logger.info('Encrypted data is not removed from storage: data not found', { id })

            return
        }

        this.logger.info('Encrypted data removed from storage', { id })
    }

    async deleteMany(ids: Types.ObjectId[]): Promise<void> {
        const { deletedCount } = await encryptedStorageModel.deleteMany({ _id: { $in: ids } })

        this.logger.info(`Encrypted data removed from storage: ${deletedCount}`)
    }

    async setExpiration(id: Types.ObjectId, expiration: number, options: QueryOptions = {}): Promise<void> {
        const storageItem = await this.getStorageItemById(id, options)

        storageItem.expiresAt = new Date(Date.now() + expiration)
        await storageItem.save()

        this.logger.info('Updated encrypted data expiration date', { id })
    }

    async getExpiration(id: Types.ObjectId): Promise<Date> {
        const storageItem = await encryptedStorageModel.findById(id, { expiresAt: 1 })

        if (!storageItem) {
            this.logger.error('Encrypted data is not found in storage', { id })

            throw new NotFoundError('Missing data')
        }

        return storageItem.expiresAt
    }

    private async getStorageItemById(id: Types.ObjectId, options: QueryOptions = {}): Promise<EncryptedStorageModel> {
        const storageItem = await encryptedStorageModel.findById(id, undefined, options)
        if (!storageItem) {
            this.logger.error('Encrypted data is not found in storage', { id })

            throw new NotFoundError('Missing data')
        }

        return storageItem
    }
}
