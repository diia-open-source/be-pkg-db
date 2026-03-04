import { config } from 'dotenv-flow'

import { AuthConfig } from '@diia-inhouse/crypto'
import { EnvService } from '@diia-inhouse/env'

import { AppDbConfig, DatabaseAdapterType, DbType, ReplicaSetNodeConfig } from '../src/interfaces'
import { TestConfig } from './interfaces/config'

config({ silent: true })

export function getConfig(): TestConfig {
    const db: AppDbConfig = {
        database: process.env.MONGO_DATABASE || '',
        replicaSet: process.env.MONGO_REPLICA_SET,
        user: process.env.MONGO_USER,
        password: process.env.MONGO_PASSWORD,
        authSource: process.env.MONGO_AUTH_SOURCE,
        port: EnvService.getVar('MONGO_PORT', 'number'),
        replicaSetNodes: EnvService.getVar('MONGO_HOSTS', 'string')
            .split(',')
            .map((replicaHost: string): ReplicaSetNodeConfig => ({ replicaHost })),
        readPreference: process.env.MONGO_READ_PREFERENCE,
        metrics: {
            enabled: false,
        },
    }

    const authConfig: AuthConfig = {
        jwk: EnvService.getVar('JWE_SECRET_DATA_JWK'),
    }

    return {
        db: { [DbType.Main]: db, [DbType.Cache]: { isEnabled: false, database: '', metrics: { enabled: false } } },
        databaseAdapter: process.env.DATABASE_ADAPTER as DatabaseAdapterType,
        postgresConfig: {
            url: process.env.POSTGRES_DATABASE_URL || '',
        },
        authConfig,
    }
}
