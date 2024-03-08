import { AuthConfig } from '@diia-inhouse/crypto'

import { AppDbConfig, DbType } from '../../src/interfaces'

export interface TestConfig {
    db: Record<DbType, AppDbConfig>
    authConfig: AuthConfig
}
