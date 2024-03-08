import { AppDbConfig, DbType } from '../../../src/interfaces/dbConfig'

export const config: Record<DbType, AppDbConfig> = {
    [DbType.Main]: {
        indexes: {
            exitAfterSync: true,
            sync: true,
        },
        isEnabled: true,
        authSource: 'admin',
        database: 'test',
        password: 'password',
        port: 27017,
        readPreference: 'primary',
        replicaSet: 'rs0',
        replicaSetNodes: [{ replicaHost: 'mongo.replica.test.host' }],
        user: 'user',
    },
    [DbType.Cache]: {
        indexes: {
            exitAfterSync: true,
            sync: false,
        },
        isEnabled: true,
        authSource: 'admin',
        database: 'cache-test',
        host: 'mongo.cache.test.host',
        password: 'password',
        readPreference: 'primary',
        replicaSet: 'rs0',
        user: 'user',
    },
}
