import { DatabaseError } from '@diia-inhouse/errors'
import { OnInit } from '@diia-inhouse/types'

import { DatabaseAdapterType, PostgresDatabase } from '../interfaces'

export class PostgresDatabaseService implements OnInit {
    constructor(
        private readonly databaseAdapter: DatabaseAdapterType,
        private readonly postgresDatabase: PostgresDatabase,
    ) {}

    async onInit(): Promise<void> {
        if (this.databaseAdapter !== 'postgres') {
            return
        }

        try {
            await this.postgresDatabase.execute('SELECT 1')
        } catch (err) {
            throw new DatabaseError('Failed to connect to postgres database', { err })
        }
    }
}
