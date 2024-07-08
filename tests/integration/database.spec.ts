import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { HealthCheckResult, HttpStatusCode } from '@diia-inhouse/types'

import { DbConnectionStatus, DbType, MongoDbStatus } from '../../src/interfaces'
import { DatabaseService } from '../../src/services/database'
import { getConfig } from '../utils'

describe('Database', () => {
    const config = getConfig()
    const logger = new DiiaLogger()
    const envService = new EnvService(logger)

    it('should return ok health status when connection is up', async () => {
        // Arrange
        const db = new DatabaseService(config.db, envService, logger)

        await db.onInit()

        // Act
        const result = await db.onHealthCheck()

        // Assert
        expect(result).toMatchObject<HealthCheckResult<MongoDbStatus>>({
            status: HttpStatusCode.OK,
            details: { mongodb: { [DbType.Main]: DbConnectionStatus.Connected } },
        })
    })
})
