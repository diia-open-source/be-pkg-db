import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { DatabaseError, UnprocessableEntityError } from '@diia-inhouse/errors'

import { MigrateMongoConfig, MongoDBErrorCode } from './interfaces'

export const MongoHelper = {
    async getMigrateMongoConfig(): Promise<MigrateMongoConfig> {
        const envService = new EnvService(new DiiaLogger())

        await envService.init()
        const user = await envService.getSecret('MONGO_USER', { accessor: 'username', nullable: true })
        const password = await envService.getSecret('MONGO_PASSWORD', { accessor: 'password', nullable: true })

        return {
            mongodb: {
                url: this.buildMongoUrl(user, password),
                databaseName: `${process.env.MONGO_DATABASE}`,
            },
            migrationsDir: 'migrations',
            changelogCollectionName: 'migrations',
            migrationFileExtension: '.ts',
            useFileHash: false,
            moduleSystem: 'commonjs',
        }
    },

    buildMongoUrl(user: string | null, password: string | null): string {
        let mongoUrl = 'mongodb://'
        if (user && password) {
            mongoUrl += `${user}:${password}@`
        }

        mongoUrl += `${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/`

        if (process.env.MONGO_AUTH_SOURCE) {
            mongoUrl += process.env.MONGO_AUTH_SOURCE
        }

        const query: string[] = []

        if (process.env.MONGO_REPLICA_SET) {
            query.push(`replicaSet=${process.env.MONGO_REPLICA_SET}`)
        }

        if (process.env.MONGO_AUTH_MECHANISM) {
            query.push(`authMechanism=${process.env.MONGO_AUTH_MECHANISM}`)
        }

        if (query.length > 0) {
            mongoUrl += `?${query.join('&')}`
        }

        return mongoUrl
    },

    getMongoErrorDupField(msg: string, fields: string[]): string | undefined {
        // eslint-disable-next-line no-restricted-syntax
        for (const field of fields) {
            const fieldRegExp = new RegExp(`${field}_[0-9] dup key`)

            if (fieldRegExp.test(msg)) {
                return field
            }
        }
    },

    handleMongoUniqError(
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
    },
}
