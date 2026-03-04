import { cloneDeep } from 'lodash'
import mongoose, { ClientSession } from 'mongoose'

import { Histogram, Observer } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { DatabaseError } from '@diia-inhouse/errors'
import { HealthCheckResult, HttpStatusCode, Logger, OnDestroy, OnHealthCheck, OnInit } from '@diia-inhouse/types'

import {
    AppDb,
    AppDbConfig,
    DatabaseAdapterType,
    DbConnectionStatus,
    DbOpLog,
    DbStatusByType,
    DbType,
    MongoDbStatus,
    MongodbOperationResult,
    MongodbOperationsLabelsMap,
    mongodbOperationsAllowedFields,
    mongodbOperationsDefaultBuckets,
} from '../interfaces'

export class DatabaseService implements OnInit, OnHealthCheck, OnDestroy {
    readonly defaultModelsDir = 'models'

    db: Partial<Record<DbType, AppDb>> = {}

    dbOperationsHistogram?: Histogram<MongodbOperationsLabelsMap>

    dbOplogObserver?: Observer<object>

    observerInterval: NodeJS.Timeout | undefined

    private dbOplog: DbOpLog = {}

    private readonly isMonitoringEnabled: boolean = false

    private readonly dbStateCodeToName: Partial<Record<mongoose.ConnectionStates, DbConnectionStatus>> = {
        [mongoose.ConnectionStates.disconnected]: DbConnectionStatus.Disconnected,
        [mongoose.ConnectionStates.connected]: DbConnectionStatus.Connected,
        [mongoose.ConnectionStates.connecting]: DbConnectionStatus.Connecting,
        [mongoose.ConnectionStates.disconnecting]: DbConnectionStatus.Disconnecting,
    }

    /**
     * https://www.mongodb.com/docs/manual/core/transactions/#read-concern-write-concern-read-preference
     */
    private readonly defaultTransactionOptions: mongoose.mongo.TransactionOptions = {
        readPreference: 'primary',
    }

    constructor(
        private readonly databaseAdapter: DatabaseAdapterType,
        private readonly dbConfigs: Partial<Record<DbType, AppDbConfig>>,

        private readonly envService: EnvService,
        private readonly logger: Logger,
    ) {
        this.isMonitoringEnabled = this.dbConfigs.main?.metrics.enabled || false
        if (this.isMonitoringEnabled) {
            this.dbOperationsHistogram = new Histogram<MongodbOperationsLabelsMap>(
                'diia_mongodb_operation_seconds',
                mongodbOperationsAllowedFields,
                'Mongodb operation duration in seconds',
                this.dbConfigs.main?.metrics.buckets || mongodbOperationsDefaultBuckets,
            )
            this.dbOplogObserver = new Observer<object>(
                'diia_mongodb_oplog_cache_size',
                [],
                'Amount of operations stored in in-memory cache for monitoring',
            )
        }
    }

    async onInit(): Promise<void> {
        if (this.databaseAdapter !== 'mongo') {
            return
        }

        const tasks = Object.entries(this.dbConfigs).map(async ([type, config]) => {
            const dbType = type as DbType
            const connection = await this.createDbConnection(dbType, config)
            if (connection) {
                this.db[dbType] = connection
            }
        })

        await Promise.all(tasks)

        if (this.isMonitoringEnabled) {
            this.observerInterval = setInterval(() => {
                this.oplogObserver()
            }, 5000)
        }
    }

    async onDestroy(): Promise<void> {
        if (this.isMonitoringEnabled) {
            clearInterval(this.observerInterval)
        }

        for (const db of Object.values(this.db)) {
            await db.connection.close()
        }
    }

    async onHealthCheck(): Promise<HealthCheckResult<MongoDbStatus>> {
        const dbStatus: DbStatusByType = {}
        for (const [type, db] of Object.entries(this.db)) {
            const dbType = type as DbType

            try {
                await db.connection.db
                    ?.listCollections(
                        {},
                        {
                            nameOnly: true,
                            authorizedCollections: true,
                        },
                    )
                    .toArray()
            } catch (err) {
                this.logger.error('Mongo list collections error', { err, dbType })
                dbStatus[dbType] = DbConnectionStatus.OpFailed
                continue
            }

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
            const { host, port, database, authSource, user, password, replicaSet, replicaSetNodes, readPreference, authMechanism } = config

            const connectionOptions: mongoose.ConnectOptions = {}
            let hosts: string[] = []
            if (host) {
                if (port) {
                    hosts.push(`${host}:${port}`)
                } else {
                    hosts.push(`${host}`)
                }
            }

            if (user && password) {
                connectionOptions.auth = { username: user, password }
            }

            if (replicaSet) {
                connectionOptions.replicaSet = replicaSet
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
            if (database) {
                connectionOptions.dbName = database
            }

            const query: string[] = []

            if (authSource) {
                query.push(`authSource=${authSource}`)
            }

            if (readPreference) {
                query.push(`readPreference=${readPreference}`)
            }

            if (authMechanism) {
                query.push(`authMechanism=${authMechanism}`)
            }

            if (query.length > 0) {
                connectionString += `?${query.join('&')}`
            }

            const logOptions = cloneDeep(connectionOptions)
            if (logOptions.auth) {
                logOptions.auth = {
                    username: '********',
                    password: '********',
                }
            }

            this.logger.info(`Connecting to DB ${connectionString} ${type}`, logOptions)
            if (this.envService.isLocal() || this.envService.isTest()) {
                this.logger.debug('Mongoose set to Debug')
                mongoose.set('debug', (coll, method, dbQuery, doc, options) => {
                    this.logger.debug('Mongo: ', { coll, method, query: dbQuery, doc, options })
                })
            }

            let connection: mongoose.Connection
            if (type === DbType.Main) {
                await mongoose.connect(connectionString, { ...connectionOptions, monitorCommands: this.isMonitoringEnabled })
                connection = mongoose.connection
            } else {
                connection = await mongoose.createConnection(connectionString, connectionOptions).asPromise()
            }

            if (this.isMonitoringEnabled) {
                this.connectMonitor(connection)
            }

            connection.on('error', (err) => {
                this.logger.error('Mongo connection error', { err, type })
            })

            return { connection, connectionString, connectionOptions }
        } catch (err) {
            this.logger.error('Failed to connect to Database', { type, err })

            throw new DatabaseError('Failed to connect to Database')
        }
    }

    /**
     * Begins a new MongoDB transaction by starting a session and transaction
     *
     * @param options - Optional transaction options to override the default transaction settings
     * @returns A ClientSession with an active transaction
     * @throws {DatabaseError} If the database connection is undefined or transaction fails to start
     *
     * @remarks
     * - Uses the main database connection to start the session
     * - Applies default transaction options (readPreference: primary)
     * - Will abort transaction and end session if any errors occur during setup
     */
    async beginTransaction(options?: mongoose.mongo.TransactionOptions): Promise<ClientSession> {
        const connection = this.db[DbType.Main]?.connection

        if (!connection) {
            throw new DatabaseError('Connection is undefined')
        }

        const session = await connection.startSession()

        try {
            const transactionOptions: mongoose.mongo.TransactionOptions = {
                ...this.defaultTransactionOptions,
                ...options,
            }

            session.startTransaction(transactionOptions)

            return session
        } catch (err) {
            await session.abortTransaction()
            await session.endSession()

            throw new DatabaseError('Unable to begin transaction', { err })
        }
    }

    private connectMonitor(connection: mongoose.Connection): void {
        try {
            const client = connection.getClient()

            client.on('commandStarted', (event) => {
                const db = event.databaseName
                const opType = event.commandName
                const key = `${event.requestId}${event.connectionId}`
                const parsedCollection = Number.parseInt(event.command[opType] || '', 10)
                const collection: string | undefined = Number.isNaN(parsedCollection) ? event.command[opType] : undefined

                this.dbOplog[key] = {
                    database: db,
                    collection,
                    opType,
                }

                this.logger.debug('Mongodb commandStarted operation', {
                    database: db,
                    collection,
                    operation: opType,
                    command: event.command,
                })
            })

            client.on('commandSucceeded', (event) => {
                const key = `${event.requestId}${event.connectionId}`
                const oplogEntry = this.dbOplog[key]
                const durationMs = event.duration

                delete this.dbOplog[key]

                this.logger.debug('Mongodb commandSucceeded operation', {
                    database: oplogEntry.database,
                    operation: oplogEntry.opType,
                    collection: oplogEntry.collection,
                })

                this.dbOperationsHistogram?.observe(
                    {
                        operation: oplogEntry.opType,
                        status: MongodbOperationResult.Successful,
                        database: oplogEntry.database,
                        ...(oplogEntry.collection && { collection: oplogEntry.collection }),
                    },
                    durationMs / 1000,
                )
            })

            client.on('commandFailed', (event) => {
                const key = `${event.requestId}${event.connectionId}`
                const oplogEntry = this.dbOplog[key]
                const durationMs = event.duration

                delete this.dbOplog[key]

                this.logger.debug('Mongodb commandFailed operation', {
                    database: oplogEntry.database,
                    operation: oplogEntry.opType,
                    collection: oplogEntry.collection,
                })
                this.dbOperationsHistogram?.observe(
                    {
                        operation: oplogEntry.opType,
                        status: MongodbOperationResult.Failed,
                        database: oplogEntry.database,
                        ...(oplogEntry.collection && { collection: oplogEntry.collection }),
                    },
                    durationMs / 1000,
                )
            })
        } catch (err) {
            this.logger.error("Couldn't attach commands monitor", { err })
        }
    }

    private oplogObserver(): void {
        this.dbOplogObserver?.observe({}, Object.keys(this.dbOplog).length)
    }
}
