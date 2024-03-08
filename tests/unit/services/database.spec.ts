const schemaStubs = {
    index: jest.fn(),
}

class SchemaMock {
    index(...args: unknown[]): unknown {
        return schemaStubs.index(...args)
    }
}
const asPromise = jest.fn()
const connectionMock = {
    on: jest.fn(),
}
const sessionMock = {
    startTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
}
const mongooseMock = {
    set: jest.fn(),
    connect: jest.fn(),
    createConnection: jest.fn(),
    connection: connectionMock,
    ConnectionStates: {
        disconnected: 'disconnected',
        connected: 'connected',
        connecting: 'connecting',
        disconnecting: 'disconnecting',
    },
    Schema: SchemaMock,
    models: {},
    model: jest.fn(),
    on: jest.fn(),
    startSession: jest.fn(),
}
const recursiveReadMock = jest.fn()

jest.mock('mongoose', () => mongooseMock)
jest.mock('recursive-readdir', () => recursiveReadMock)

import Logger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { DatabaseError } from '@diia-inhouse/errors'
import { mockInstance } from '@diia-inhouse/test'
import { HttpStatusCode } from '@diia-inhouse/types'

import { AppDb, AppDbConfig, DatabaseService, DbType } from '../../../src'
import { config } from '../../mocks/services/database'

describe('DatabaseService', () => {
    const now = Date.now()
    const logger = mockInstance(Logger)
    const envService = mockInstance(EnvService)

    beforeEach(() => {
        jest.useFakeTimers({ now })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    describe('method: `onInit`', () => {
        it('shoudl successfully init database connections based on config', async () => {
            const databaseService = new DatabaseService(config, envService, logger)

            jest.spyOn(databaseService, 'createDbConnection').mockResolvedValue(<AppDb>(<unknown>{ connection: mongooseMock }))
            jest.spyOn(databaseService, 'syncIndexes').mockResolvedValue()

            await databaseService.onInit()

            expect(databaseService.createDbConnection).toHaveBeenCalledWith(DbType.Main, config[DbType.Main])
            expect(databaseService.createDbConnection).toHaveBeenCalledWith(DbType.Cache, config[DbType.Cache])
            expect(databaseService.syncIndexes).toHaveBeenCalledWith(config[DbType.Main].indexes?.exitAfterSync)
        })
    })

    describe('method: `onHealthCheck`', () => {
        it('should return service unavailable status', async () => {
            const databaseService = new DatabaseService(config, envService, logger)

            jest.spyOn(databaseService, 'createDbConnection').mockResolvedValue(<AppDb>(
                (<unknown>{ connection: { readyState: mongooseMock.ConnectionStates.connecting } })
            ))
            jest.spyOn(databaseService, 'syncIndexes').mockResolvedValue()

            await databaseService.onInit()

            expect(await databaseService.onHealthCheck()).toEqual({
                status: HttpStatusCode.SERVICE_UNAVAILABLE,
                details: {
                    mongodb: {
                        [DbType.Main]: mongooseMock.ConnectionStates.connecting,
                        [DbType.Cache]: mongooseMock.ConnectionStates.connecting,
                    },
                },
            })
        })

        it('should return service ok status', async () => {
            const databaseService = new DatabaseService(config, envService, logger)

            jest.spyOn(databaseService, 'createDbConnection').mockResolvedValue(<AppDb>(
                (<unknown>{ connection: { readyState: mongooseMock.ConnectionStates.connected } })
            ))
            jest.spyOn(databaseService, 'syncIndexes').mockResolvedValue()

            await databaseService.onInit()

            expect(await databaseService.onHealthCheck()).toEqual({
                status: HttpStatusCode.OK,
                details: {
                    mongodb: {
                        [DbType.Main]: mongooseMock.ConnectionStates.connected,
                        [DbType.Cache]: mongooseMock.ConnectionStates.connected,
                    },
                },
            })
        })
    })

    describe('method: `createDbConnection`', () => {
        const databaseService = new DatabaseService(config, envService, logger)

        it('should skip db connection creation in case database is disabled', async () => {
            await databaseService.createDbConnection(DbType.Main, { isEnabled: false })

            expect(logger.info).toHaveBeenCalledWith(`Database is disabled: ${DbType.Main}`)
        })

        it.each([
            [
                'host is provided for cache db type without port',
                DbType.Cache,
                config[DbType.Cache],
                {
                    connection: mongooseMock,
                    connectionOptions: { auth: { password: 'password', username: 'user' }, dbName: 'cache-test', replicaSet: 'rs0' },
                    connectionString: 'mongodb://mongo.cache.test.host/?authSource=admin&readPreference=primary',
                },
                { auth: { password: '********', username: '********' }, dbName: 'cache-test', replicaSet: 'rs0' },
            ],
            [
                'host is provided for cache db type with port',
                DbType.Cache,
                { ...config[DbType.Cache], port: 27017 },
                {
                    connection: mongooseMock,
                    connectionOptions: { auth: { password: 'password', username: 'user' }, dbName: 'cache-test', replicaSet: 'rs0' },
                    connectionString: 'mongodb://mongo.cache.test.host:27017/?authSource=admin&readPreference=primary',
                },
                { auth: { password: '********', username: '********' }, dbName: 'cache-test', replicaSet: 'rs0' },
            ],
            [
                'replica set is provided for main db type',
                DbType.Main,
                config[DbType.Main],
                {
                    connection: connectionMock,
                    connectionOptions: { auth: { password: 'password', username: 'user' }, dbName: 'test', replicaSet: 'rs0' },
                    connectionString: 'mongodb://mongo.replica.test.host:27017/?authSource=admin&readPreference=primary',
                },
                { auth: { password: '********', username: '********' }, dbName: 'test', replicaSet: 'rs0' },
            ],
        ])(
            'should successfully create connection when %s',
            async (_msg, type: DbType, inputConfig: AppDbConfig, expectedConnection, expectedLogOptions) => {
                jest.spyOn(envService, 'isTest').mockReturnValue(true)
                mongooseMock.set.mockImplementationOnce((_logType, logCaller) => {
                    logCaller('coll', 'set', 'db-query', 'doc', {})
                })
                mongooseMock.createConnection.mockReturnValue({ asPromise })
                asPromise.mockResolvedValue(mongooseMock)
                connectionMock.on.mockImplementationOnce((_evenType, cb) => {
                    cb(null)
                })

                expect(await databaseService.createDbConnection(type, inputConfig)).toEqual(expectedConnection)
                expect(logger.info).toHaveBeenCalledWith(
                    `Connecting to DB ${expectedConnection.connectionString} ${type}`,
                    expectedLogOptions,
                )
                expect(logger.debug).toHaveBeenCalledWith('Mongoose set to Debug')
                expect(logger.debug).toHaveBeenCalledWith('Mongo: ', {
                    coll: 'coll',
                    method: 'set',
                    query: 'db-query',
                    doc: 'doc',
                    options: {},
                })
            },
        )

        it('should fail to create connection in case host and replica set node are provided at the same time', async () => {
            const expectedError = new DatabaseError('Failed to connect to Database')

            await expect(async () => {
                await databaseService.createDbConnection(DbType.Main, { ...config[DbType.Main], host: 'mongo.test.host' })
            }).rejects.toEqual(expectedError)
            expect(logger.error).toHaveBeenCalledWith(
                'Wrong database configuration:',
                'Must be only `host` and `port` or `replicaSetNodes` config',
            )
            expect(logger.error).toHaveBeenCalledWith('Failed to connect to Database', {
                type: DbType.Main,
                err: new Error('Must be only `host` and `port` or `replicaSetNodes` config'),
            })
        })
    })

    describe('method: `syncIndexes`', () => {
        it('should successfully run sync indexes', async () => {
            const databaseService = new DatabaseService(config, envService, logger)

            recursiveReadMock.mockResolvedValue([
                `${__dirname}../../../mocks/models/user.js`,
                `${__dirname}../../../mocks/models/profile.js`,
            ])
            jest.spyOn(process, 'exit').mockReturnValue(<never>'ok')

            await databaseService.syncIndexes(true, 'models')

            expect(recursiveReadMock).toHaveBeenCalledWith('./dist/models', ['*.map', 'index.js', 'schemas'])
            expect(logger.info).toHaveBeenCalledWith(`Ended syncing indexes in 0 ms`)
        })

        it('should fail to run sync indexes in case recursive read is failed', async () => {
            const expectedError = new Error('Unable to read list of files')
            const databaseService = new DatabaseService(config, envService, logger)

            recursiveReadMock.mockRejectedValue(expectedError)

            await expect(async () => {
                await databaseService.syncIndexes()
            }).rejects.toEqual(expectedError)

            expect(recursiveReadMock).toHaveBeenCalledWith('./dist/models', ['*.map', 'index.js', 'schemas'])
            expect(logger.error).toHaveBeenCalledWith('Failed to syncing indexes', { err: expectedError })
        })
    })

    describe('method: `beginTransaction`', () => {
        it('should fail to begin transaction is case there is no connection', async () => {
            const databaseService = new DatabaseService(config, envService, logger)

            await expect(async () => {
                await databaseService.beginTransaction(DbType.Main)
            }).rejects.toEqual(new DatabaseError('Connection is undefined'))
        })

        it('should fail to begin transaction in case error is occurred when starting transaction session', async () => {
            const expectedError = new Error('Unable to start transaction')
            const databaseService = new DatabaseService(config, envService, logger)

            jest.spyOn(databaseService, 'createDbConnection').mockResolvedValue(<AppDb>(<unknown>{ connection: mongooseMock }))
            jest.spyOn(databaseService, 'syncIndexes').mockResolvedValue()
            mongooseMock.startSession.mockResolvedValue(sessionMock)
            sessionMock.abortTransaction.mockResolvedValueOnce(null)
            sessionMock.endSession.mockResolvedValueOnce(null)
            sessionMock.startTransaction.mockImplementationOnce(() => {
                throw expectedError
            })

            await databaseService.onInit()

            await expect(async () => {
                await databaseService.beginTransaction()
            }).rejects.toEqual(new DatabaseError('Unable to begin transaction', { err: expectedError }))
        })

        it('should successfully begin transaction', async () => {
            const databaseService = new DatabaseService(config, envService, logger)

            jest.spyOn(databaseService, 'createDbConnection').mockResolvedValue(<AppDb>(<unknown>{ connection: mongooseMock }))
            jest.spyOn(databaseService, 'syncIndexes').mockResolvedValue()
            mongooseMock.startSession.mockResolvedValue(sessionMock)
            sessionMock.abortTransaction.mockResolvedValueOnce(null)
            sessionMock.endSession.mockResolvedValueOnce(null)
            sessionMock.startTransaction.mockResolvedValueOnce(sessionMock)

            await databaseService.onInit()

            expect(await databaseService.beginTransaction()).toEqual(sessionMock)
        })
    })
})
