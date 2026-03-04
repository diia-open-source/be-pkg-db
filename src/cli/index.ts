#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { Logger } from '@diia-inhouse/types'

import { DbType } from '../interfaces'
import { DatabaseService } from '../services/database'
import { CleanupExpiredDataCommand } from './cleanupExpiredData'
import { RunMigrationCommand } from './runMigration'
import { SyncIndexesCommand } from './syncIndexes'

async function createDatabaseService(envService: EnvService, logger: Logger): Promise<DatabaseService> {
    return new DatabaseService(
        'mongo',
        {
            [DbType.Main]: {
                database: EnvService.getVar('MONGO_DATABASE'),
                replicaSet: EnvService.getVar('MONGO_REPLICA_SET'),
                user: await envService.getSecret('MONGO_USER', { accessor: 'username', nullable: true }),
                password: await envService.getSecret('MONGO_PASSWORD', { accessor: 'password', nullable: true }),
                authSource: EnvService.getVar('MONGO_AUTH_SOURCE', 'string', null),
                port: EnvService.getVar('MONGO_PORT', 'number'),
                replicaSetNodes: EnvService.getVar('MONGO_HOSTS', 'string')
                    .split(',')
                    .map((replicaHost: string) => ({ replicaHost })),
                readPreference: EnvService.getVar('MONGO_READ_PREFERENCE'),
                metrics: {
                    enabled: false,
                },
            },
        },
        envService,
        logger,
    )
}

async function main(): Promise<void> {
    await yargs(hideBin(process.argv))
        .command(
            'sync-indexes',
            'Sync indexes for MongoDB models',
            (args) =>
                args.option('modelsDir', {
                    type: 'string',
                    default: 'models',
                    describe: 'Directory for models',
                }),
            async (argv) => {
                const logger = new DiiaLogger()
                const envService = new EnvService(logger)

                await envService.init()
                const command = new SyncIndexesCommand(logger)
                try {
                    const databaseService = await createDatabaseService(envService, logger)

                    await databaseService.onInit()
                    await command.run(argv.modelsDir)
                    await databaseService.onDestroy()
                } finally {
                    await envService.onDestroy()
                }
            },
        )
        .command(
            'migrate',
            'Run MongoDB migration script',
            (args) =>
                args
                    .option('path', {
                        type: 'string',
                        demandOption: true,
                        describe: 'Path to migration script',
                    })
                    .option('down', {
                        type: 'boolean',
                        default: false,
                        describe: 'Run migration down script',
                    }),
            async (argv) => {
                const logger = new DiiaLogger()
                const envService = new EnvService(logger)

                await envService.init()
                try {
                    const databaseService = await createDatabaseService(envService, logger)

                    await databaseService.onInit()

                    const db = databaseService.db.main?.connection.db
                    const client = databaseService.db.main?.connection.getClient()
                    if (!db || !client) {
                        throw new Error('Expected db and client to be defined')
                    }

                    const command = new RunMigrationCommand(logger, db, client)

                    await command.run(argv.path, argv.down)
                    await databaseService.onDestroy()
                } finally {
                    await envService.onDestroy()
                }
            },
        )
        .command(
            'pg-cleanup-expired-data',
            'Cleanup expired data for PostgreSQL tables based on expiring timestamp',
            (args) =>
                args.option('path', {
                    type: 'string',
                    default: 'db/schemas',
                    describe: 'Path to schemas directory',
                }),
            async (argv) => {
                const logger = new DiiaLogger()
                const envService = new EnvService(logger)

                await envService.init()
                try {
                    const command = new CleanupExpiredDataCommand(logger)

                    await command.run(argv.path)
                } finally {
                    await envService.onDestroy()
                }
            },
        )
        .help().argv
}

void main()
