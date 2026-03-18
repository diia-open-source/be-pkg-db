import { eq, inArray } from 'drizzle-orm'
import { Model, QueryOptions } from 'mongoose'

import { AuthService } from '@diia-inhouse/crypto'
import { EnvService } from '@diia-inhouse/env'
import { NotFoundError } from '@diia-inhouse/errors'
import { Logger } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import { DatabaseAdapterType, PostgresDatabase } from '../interfaces'
import { EncryptedStorage } from '../interfaces/models/encryptedStorage'
import { encryptedStorage } from '../tables/encryptedStorage'

/**
 * EncryptedStorageService provides CRUD operations for managing encrypted storage entries
 * in both Postgres and MongoDB databases. The service abstracts database implementation details
 * using a strategy pattern depending on the configured database adapter type.
 *
 * Suitable for storing and managing sensitive data in an encrypted manner with specific expiration time.
 *
 * This service should be wrapped in a repository.
 *
 * Register this service in the DI container with the following (MongoDB) configuration (AuthService is located in @diia-inhouse/crypto):
 * ```typescript
 * // src/deps.ts
 * encryptedStorage: asClass(EncryptedStorageService, { injector: () => ({ encryptedStorageModel }) }).singleton(),
 * auth: asClass(AuthService, { injector: () => ({ authConfig: config.auth }) }).singleton()
 * ```
 *
 * ```typescript
 * // src/config.ts
 * auth: {
 *     jwk: await envService.getSecret('JWE_SECRET_DATA_JWK'),
 * }
 * ```
 *
 * ```typescript
 * // src/models/encryptedStorage.ts
 * import { EncryptedStorage, Model, encryptedStorageSchema, model, models } from '@diia-inhouse/db'
 *
 * export default (models.EncryptedStorage as Model<EncryptedStorage>) || model('EncryptedStorage', encryptedStorageSchema)
 * ```
 *
 * Use the following command to generate a JWE secret data JWK:
 * node -e "const crypto = require('crypto'); const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); const jwk = privateKey.export({ format: 'jwk' }); jwk.use = 'enc'; console.log(JSON.stringify(jwk));"
 * ```typescript
 * // .env.example
 * JWE_SECRET_DATA_JWK={your-jwk-here}
 * ```
 */
export class EncryptedStorageService {
    private readonly saveEntityStrategy: Record<DatabaseAdapterType, (storageItem: EncryptedStorage) => Promise<string>> = {
        postgres: async (storageItem: EncryptedStorage): Promise<string> => {
            const result = await this.getPostgresDatabase()
                .insert(encryptedStorage)
                .values(storageItem)
                .returning()
                .then((rows) => rows[0])

            return result.id
        },
        mongo: async (storageItem: EncryptedStorage): Promise<string> => {
            const result = await this.getModel().create(storageItem)

            return result._id.toString()
        },
    }

    private readonly updateEntityStrategy: Record<
        DatabaseAdapterType,
        (id: string, updateData: Partial<EncryptedStorage>) => Promise<void>
    > = {
        postgres: async (id: string, updateData: Partial<EncryptedStorage>): Promise<void> => {
            await this.getPostgresDatabase().update(encryptedStorage).set(updateData).where(eq(encryptedStorage.id, id))
        },
        mongo: async (id: string, updateData: Partial<EncryptedStorage>): Promise<void> => {
            await this.getModel().findByIdAndUpdate(id, updateData)
        },
    }

    private readonly findEntityStrategy: Record<
        DatabaseAdapterType,
        (id: string, options: QueryOptions) => Promise<EncryptedStorage | null | undefined>
    > = {
        postgres: async (id: string): Promise<EncryptedStorage | undefined> => {
            return await this.getPostgresDatabase()
                .select()
                .from(encryptedStorage)
                .where(eq(encryptedStorage.id, id))
                .then((rows) => rows[0])
        },
        mongo: async (id: string, options: QueryOptions): Promise<EncryptedStorage | null> => {
            return await this.getModel().findById(id, undefined, options)
        },
    }

    private readonly deleteManyStrategy: Record<DatabaseAdapterType, (ids: string[]) => Promise<number>> = {
        postgres: async (ids: string[]): Promise<number> => {
            const result = await this.getPostgresDatabase().delete(encryptedStorage).where(inArray(encryptedStorage.id, ids))

            return result.rowCount!
        },
        mongo: async (ids: string[]): Promise<number> => {
            const result = await this.getModel().deleteMany({ _id: { $in: ids } })

            return result.deletedCount
        },
    }

    private readonly removeEntityStrategy: Record<DatabaseAdapterType, (id: string) => Promise<EncryptedStorage | null>> = {
        postgres: async (id: string): Promise<EncryptedStorage | null> => {
            return await this.getPostgresDatabase()
                .delete(encryptedStorage)
                .where(eq(encryptedStorage.id, id))
                .returning()
                .then((rows) => rows[0])
        },
        mongo: async (id: string): Promise<EncryptedStorage | null> => {
            return await this.getModel().findOneAndDelete({ _id: id })
        },
    }

    private readonly findExpirationStrategy: Record<DatabaseAdapterType, (id: string) => Promise<Date | undefined>> = {
        postgres: async (id: string): Promise<Date | undefined> => {
            return await this.getPostgresDatabase()
                .select({ expiresAt: encryptedStorage.expiresAt })
                .from(encryptedStorage)
                .where(eq(encryptedStorage.id, id))
                .then((rows) => rows[0].expiresAt)
        },
        mongo: async (id: string): Promise<Date | undefined> => {
            const result = await this.getModel().findById(id, { expiresAt: 1 })

            return result?.expiresAt
        },
    }

    constructor(
        private readonly logger: Logger,
        private readonly auth: AuthService,
        private readonly envService: EnvService,
        private readonly databaseAdapter: DatabaseAdapterType,
        private readonly encryptedStorageModel: Model<EncryptedStorage> | null = null,
        private readonly postgresDatabase: PostgresDatabase | null = null,
    ) {}

    async save<T>(data: T, expiration: number): Promise<string> {
        const encryptedData = await this.auth.encryptJWE(utils.encodeObjectToBase64(data))

        const storageItem: EncryptedStorage = {
            data: encryptedData,
            expiresAt: new Date(Date.now() + expiration),
        }

        if (!this.envService.isProd()) {
            storageItem.source = data
        }

        return await this.saveEntityStrategy[this.databaseAdapter](storageItem)
    }

    async get<T>(id: string, options: QueryOptions = {}): Promise<T> {
        const storageItem = await this.getStorageItemById(id, options)
        const decryptedData = await this.auth.decryptJWE<string>(storageItem.data)

        return await utils.decodeObjectFromBase64(decryptedData)
    }

    async getSafe<T>(id: string, options: QueryOptions = {}): Promise<T | undefined> {
        try {
            return await this.get(id, options)
        } catch (err) {
            this.logger.log('Unable to retrieve data from encrypted storage', { err })

            return undefined
        }
    }

    async update<T>(id: string, data: T): Promise<void> {
        const storageItem = await this.getStorageItemById(id)
        const encryptedData = await this.auth.encryptJWE(utils.encodeObjectToBase64(data))

        storageItem.data = encryptedData

        if (!this.envService.isProd()) {
            storageItem.source = data
        }

        await this.updateEntityStrategy[this.databaseAdapter](id, storageItem)
    }

    async remove(id: string): Promise<void> {
        const storageItem = await this.removeEntityStrategy[this.databaseAdapter](id)

        if (!storageItem) {
            this.logger.info('Encrypted data is not removed from storage: data not found', { id })

            return
        }

        this.logger.info('Encrypted data removed from storage', { id })
    }

    async deleteMany(ids: string[]): Promise<void> {
        const deletedCount = await this.deleteManyStrategy[this.databaseAdapter](ids)

        this.logger.info(`Encrypted data removed from storage: ${deletedCount}`)
    }

    async setExpiration(id: string, expiration: number, options: QueryOptions = {}): Promise<void> {
        const storageItem = await this.getStorageItemById(id, options)

        storageItem.expiresAt = new Date(Date.now() + expiration)

        await this.updateEntityStrategy[this.databaseAdapter](id, { expiresAt: storageItem.expiresAt })

        this.logger.info('Updated encrypted data expiration date', { id })
    }

    async getExpiration(id: string): Promise<Date> {
        const expiresAt = await this.findExpirationStrategy[this.databaseAdapter](id)

        if (!expiresAt) {
            this.logger.error('Encrypted data is not found in storage', { id })
            throw new NotFoundError('Missing data')
        }

        return expiresAt
    }

    private async getStorageItemById(id: string, options: QueryOptions = {}): Promise<EncryptedStorage> {
        const storageItem = await this.findEntityStrategy[this.databaseAdapter](id, options)

        if (!storageItem) {
            this.logger.error('Encrypted data is not found in storage', { id })
            throw new NotFoundError('Missing data')
        }

        return storageItem
    }

    private getModel(): Model<EncryptedStorage> | never {
        if (!this.encryptedStorageModel) {
            throw new Error('Encrypted storage model is not provided')
        }

        return this.encryptedStorageModel
    }

    private getPostgresDatabase(): PostgresDatabase {
        if (!this.postgresDatabase) {
            throw new Error('Postgres database is not provided')
        }

        return this.postgresDatabase
    }
}
