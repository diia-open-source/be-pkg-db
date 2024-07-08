import { config } from 'dotenv-flow'

import { AuthConfig } from '@diia-inhouse/crypto'
import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'

import { AppDbConfig, DbType, ReplicaSetNodeConfig } from '../src/interfaces'

import { TestConfig } from './interfaces/config'

config({ silent: true })

const logger = new DiiaLogger()
const envService = new EnvService(logger)

export function getConfig(): TestConfig {
    const db: AppDbConfig = {
        database: process.env.MONGO_DATABASE,
        replicaSet: process.env.MONGO_REPLICA_SET,
        user: process.env.MONGO_USER,
        password: process.env.MONGO_PASSWORD,
        authSource: process.env.MONGO_AUTH_SOURCE,
        port: envService.getVar('MONGO_PORT', 'number'),
        replicaSetNodes: envService
            .getVar('MONGO_HOSTS', 'string')
            .split(',')
            .map((replicaHost: string): ReplicaSetNodeConfig => ({ replicaHost })),
        readPreference: process.env.MONGO_READ_PREFERENCE,
        indexes: {
            sync: process.env.MONGO_INDEXES_SYNC === 'true',
            exitAfterSync: process.env.MONGO_INDEXES_EXIT_AFTER_SYNC === 'true',
        },
    }

    const authConfig: AuthConfig = {
        jwk: envService.getVar('JWE_SECRET_DATA_JWK'),
    }

    return {
        db: { [DbType.Main]: db, [DbType.Cache]: { isEnabled: false } },
        authConfig,
    }
}
