import { DatabaseError, UnprocessableEntityError } from '@diia-inhouse/errors'

import { MigrateMongoConfig, MongoDBErrorCode } from './interfaces'

export class MongoHelper {
    static migrateMongoConfig: MigrateMongoConfig = {
        mongodb: {
            url: this.buildMongoUrl(),
            databaseName: `${process.env.MONGO_DATABASE}`,
        },
        migrationsDir: 'migrations',
        changelogCollectionName: 'migrations',
        migrationFileExtension: '.ts',
        useFileHash: false,
        moduleSystem: 'commonjs',
    }

    static buildMongoUrl(): string {
        let mongoUrl = 'mongodb://'
        if (process.env.MONGO_USER && process.env.MONGO_PASSWORD) {
            mongoUrl += `${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@`
        }

        mongoUrl += `${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/`

        if (process.env.MONGO_AUTH_SOURCE) {
            mongoUrl += process.env.MONGO_AUTH_SOURCE
        }

        if (process.env.MONGO_REPLICA_SET) {
            mongoUrl += `?replicaSet=${process.env.MONGO_REPLICA_SET}`
        }

        return mongoUrl
    }

    static getMongoErrorDupField(msg: string, fields: string[]): string | undefined {
        // eslint-disable-next-line no-restricted-syntax
        for (const field of fields) {
            const fieldRegExp = RegExp(`${field}_[0-9] dup key`)

            if (fieldRegExp.test(msg)) {
                return field
            }
        }
    }

    static handleMongoUniqError(
        err: Error & { code?: number },
        params: Record<string, unknown>,
        uniqFieldNames: string[],
        modelName: string,
    ): void {
        if (err.name === 'MongoError' && err.code === MongoDBErrorCode.DuplicateKey) {
            const field = MongoHelper.getMongoErrorDupField(err.message, uniqFieldNames)

            if (field) {
                throw new UnprocessableEntityError(`${modelName} with ${field} '${params[field]}' already exists`, {
                    field,
                    message: `${field} field unique constraint`,
                    type: 'unique',
                    value: params[field],
                })
            }

            throw new Error(`Unexpected error while entity processing. ${err.message}`)
        }

        throw new DatabaseError(err.toString())
    }
}
