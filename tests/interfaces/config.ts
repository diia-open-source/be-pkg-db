import { AuthConfig } from '@diia-inhouse/crypto'

import { AppDbConfig, DatabaseAdapterType, DbType, PostgresDbConfig } from '../../src/interfaces'

export interface TestConfig {
    db: Record<DbType, AppDbConfig>
    authConfig: AuthConfig
    databaseAdapter: DatabaseAdapterType
    postgresConfig: PostgresDbConfig
}
