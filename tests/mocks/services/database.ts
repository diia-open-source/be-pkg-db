import { AppDbConfig, DbType } from '../../../src/interfaces/dbConfig'

export const config: Record<DbType, AppDbConfig> = {
    [DbType.Main]: {
        isEnabled: true,
        authSource: 'admin',
        database: 'test',
        password: 'password',
        port: 27017,
        readPreference: 'primary',
        replicaSet: 'rs0',
        replicaSetNodes: [{ replicaHost: 'mongo.replica.test.host' }],
        user: 'user',
        metrics: {
            enabled: false,
        },
    },
    [DbType.Cache]: {
        isEnabled: true,
        authSource: 'admin',
        database: 'cache-test',
        host: 'mongo.cache.test.host',
        password: 'password',
        readPreference: 'primary',
        replicaSet: 'rs0',
        user: 'user',
        metrics: {
            enabled: false,
        },
    },
}
