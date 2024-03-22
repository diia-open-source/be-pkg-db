import fs from 'fs'
import { resolve } from 'path'

import { cloneDeep } from 'lodash'
import mongoose, { ClientSession } from 'mongoose'
import recursiveRead from 'recursive-readdir'

import { EnvService } from '@diia-inhouse/env'
import { DatabaseError } from '@diia-inhouse/errors'
import { HealthCheckResult, HttpStatusCode, Logger, OnHealthCheck, OnInit } from '@diia-inhouse/types'

import { AppDb, AppDbConfig, DbConnectionStatus, DbStatusByType, DbType, MongoDbStatus } from '../interfaces'

export class DatabaseService implements OnInit, OnHealthCheck {
    private readonly dbStateCodeToName: Partial<Record<mongoose.ConnectionStates, DbConnectionStatus>> = {
        [mongoose.ConnectionStates.disconnected]: DbConnectionStatus.Disconnected,
        [mongoose.ConnectionStates.connected]: DbConnectionStatus.Connected,
        [mongoose.ConnectionStates.connecting]: DbConnectionStatus.Connecting,
        [mongoose.ConnectionStates.disconnecting]: DbConnectionStatus.Disconnecting,
    }

    readonly defaultModelsDir = 'models'

    db: Partial<Record<DbType, AppDb>> = {}

    constructor(
        private readonly dbConfigs: Record<DbType, AppDbConfig>,
        private readonly envService: EnvService,
        private readonly logger: Logger,
    ) {}

    async onInit(): Promise<void> {
        const tasks = Object.entries(this.dbConfigs).map(async ([type, config]) => {
            const dbType = <DbType>type

            this.db[dbType] = await this.createDbConnection(dbType, config)
        })

        await Promise.all(tasks)

        const mainConfig = this.dbConfigs[DbType.Main]
        if (mainConfig?.indexes?.sync) {
            await this.syncIndexes(mainConfig.indexes.exitAfterSync)
        }
    }

    async onHealthCheck(): Promise<HealthCheckResult<MongoDbStatus>> {
        const dbStatus: DbStatusByType = {}
        for (const [type, db] of Object.entries(this.db)) {
            const dbType = <DbType>type

            dbStatus[dbType] = this.dbStateCodeToName[db.connection.readyState]
        }

        const status = Object.values(dbStatus).some((s) => s !== DbConnectionStatus.Connected)
            ? HttpStatusCode.SERVICE_UNAVAILABLE
            : HttpStatusCode.OK

        return {
            status,
            details: { mongodb: dbStatus },
        }
    }

    async createDbConnection(type: DbType, config: AppDbConfig): Promise<AppDb | undefined> {
        const { isEnabled } = config

        if (typeof isEnabled === 'boolean' && !isEnabled) {
            this.logger.info(`Database is disabled: ${type}`)

            return
        }

        try {
            const connectionOptions = this.initializeConnectionOptions(config)
            const connectionString = this.initializeConnectionString(config)

            this.logger.info(`Connecting to DB ${connectionString} ${type}`, this.initializeLogOptions(connectionOptions))
            if (this.envService.isLocal() || this.envService.isTest()) {
                this.logger.debug('Mongoose set to Debug')
                mongoose.set('debug', (coll, method, dbQuery, doc, options) => {
                    this.logger.debug('Mongo: ', { coll, method, query: dbQuery, doc, options })
                })
            }

            const connection = await this.connectToMongoose(type, connectionString, connectionOptions)

            connection.on('error', (err) => {
                this.logger.error('Mongo connection error', { err, type })
            })

            return { connection, connectionString, connectionOptions }
        } catch (err) {
            this.logger.error('Failed to connect to Database', { type, err })

            throw new DatabaseError('Failed to connect to Database')
        }
    }

    async syncIndexes(exitAfterSync = false, modelsDir?: string): Promise<void> {
        const modelsPath = `./dist/${modelsDir || this.defaultModelsDir}`

        try {
            if (!fs.existsSync(modelsPath)) {
                this.logger.info('Models dir is absent, indexes sync skipped')

                return
            }

            const t0 = Date.now()

            this.logger.info('Start syncing indexes')
            const files = await recursiveRead(modelsPath, ['*.map', 'index.js', 'schemas'])
            const tasks = []
            for (const fileName of files) {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const modelModule = require(resolve(fileName))
                if (modelModule.skipSyncIndexes) {
                    continue
                }

                const task = modelModule.default

                tasks.push(this.syncModel(task))
            }

            await Promise.all(tasks)
            this.logger.info(`Ended syncing indexes in ${Date.now() - t0} ms`)
            this.logger.info('Successfully synced indexes')
        } catch (err) {
            this.logger.error('Failed to syncing indexes', { err })
            throw err
        } finally {
            if (exitAfterSync) {
                this.logger.info('Process exit after synced indexes')
                // eslint-disable-next-line no-process-exit
                process.exit(0)
            }
        }
    }

    async beginTransaction(dbType: DbType = DbType.Main): Promise<ClientSession> {
        const connection = this.db[dbType]?.connection

        if (!connection) {
            throw new DatabaseError('Connection is undefined')
        }

        const session = await connection.startSession()

        try {
            session.startTransaction()

            return session
        } catch (err) {
            await session.abortTransaction()
            await session.endSession()

            throw new DatabaseError('Unable to begin transaction', { err })
        }
    }

    private async syncModel(model: mongoose.Model<unknown>): Promise<void> {
        const t0 = Date.now()

        this.logger.info(`Start syncing indexes for the ${model.modelName} collection`)
        await model.syncIndexes()
        this.logger.info(`Ended syncing indexes for the ${model.modelName} collection in ${Date.now() - t0} ms`)
    }

    private initializeConnectionOptions(config: AppDbConfig): mongoose.ConnectOptions  {
        const {user,password,replicaSet,database} = config;

        const options: mongoose.ConnectOptions = {}

        if (user && password) {
            options.auth = { username: user, password }
        }

        if (replicaSet) {
            options.replicaSet = replicaSet
        }

        if (database) {
            options.dbName = database
        }

        return options
    }

    private initializeConnectionString(config: AppDbConfig): string  {
        const { host,port, replicaSetNodes } = config;

        let hosts: string[] = []

        if (host) {
            if (port) {
                hosts.push(`${host}:${port}`)
            } else {
                hosts.push(`${host}`)
            }
        }

        if (replicaSetNodes) {
            if (host) {
                const errMsg = 'Must be only `host` and `port` or `replicaSetNodes` config'

                this.logger.error('Wrong database configuration:', errMsg)
                throw new Error(errMsg)
            }

            hosts = replicaSetNodes.map(({ replicaHost }) => `${replicaHost}:${port}`)
        }

        let connectionString = `mongodb://${hosts.join(',')}/`

        const { authSource, readPreference } = config;

        const query: string[] = []

        if (authSource) {
            query.push(`authSource=${authSource}`)
        }

        if (readPreference) {
            query.push(`readPreference=${readPreference}`)
        }

        if (query.length) {
            connectionString += `?${query.join('&')}`
        }

        return connectionString
    }

    private initializeLogOptions(connectionOptions: mongoose.ConnectOptions): mongoose.ConnectOptions  {
        const logOptions = cloneDeep(connectionOptions)

        if (logOptions.auth) {
            logOptions.auth = {
                username: '********',
                password: '********',
            }
        }

        return logOptions
    }

    private async connectToMongoose(type: DbType, connectionString: string, connectionOptions: mongoose.ConnectOptions): mongoose.Connection  {
        let connection: mongoose.Connection

        if (type === DbType.Main) {
            await mongoose.connect(connectionString, connectionOptions)
            connection = mongoose.connection
        } else {
            connection = await mongoose.createConnection(connectionString, connectionOptions).asPromise()
        }

        return connection
    }
}
