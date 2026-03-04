/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { ClientSession, Connection } from 'mongoose'
import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { DatabaseError } from '@diia-inhouse/errors'
import { HttpStatusCode } from '@diia-inhouse/types'

import { AppDb, AppDbConfig, DatabaseService, DbConnectionStatus, DbType } from '../../../src'
import { config } from '../../mocks/services/database'

vi.mock('mongoose', async (importOriginal) => {
    const original = await importOriginal<typeof mongoose>()

    return {
        ...original,
        default: {
            ...original.default,
            set: vi.fn(),
            connect: vi.fn(),
            createConnection: vi.fn(),
            connection: { on: vi.fn(), startSession: vi.fn() },
            ConnectionStates: {
                disconnected: 'disconnected',
                connected: 'connected',
                connecting: 'connecting',
                disconnecting: 'disconnecting',
            },
            Schema: class SchemaMock {
                index(...args: unknown[]): unknown {
                    return { index: vi.fn() }.index(...args)
                }
            },
            models: {},
            model: vi.fn(),
            on: vi.fn(),
            startSession: vi.fn(),
        },
    }
})

describe('DatabaseService', () => {
    const now = Date.now()
    const logger = mock<Logger>()
    const envService = mock<EnvService>()

    beforeEach(() => {
        vi.useFakeTimers({ now })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('method: `onInit`', () => {
        it('shoudl successfully init database connections based on config', async () => {
            const databaseService = new DatabaseService('mongo', config, envService, logger)

            vi.spyOn(databaseService, 'createDbConnection').mockResolvedValue({
                connection: vi.mocked(mongoose.connection),
            } as unknown as AppDb)

            await databaseService.onInit()

            expect(databaseService.createDbConnection).toHaveBeenCalledWith(DbType.Main, config[DbType.Main])
            expect(databaseService.createDbConnection).toHaveBeenCalledWith(DbType.Cache, config[DbType.Cache])
        })
    })

    describe('method: `onHealthCheck`', () => {
        it('should return service unavailable status', async () => {
            const databaseService = new DatabaseService('mongo', config, envService, logger)

            vi.spyOn(databaseService, 'createDbConnection').mockResolvedValue({
                connection: {
                    readyState: vi.mocked(mongoose).ConnectionStates.connecting,
                    db: { listCollections: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) },
                },
            } as unknown as AppDb)

            await databaseService.onInit()

            expect(await databaseService.onHealthCheck()).toEqual({
                status: HttpStatusCode.SERVICE_UNAVAILABLE,
                details: {
                    mongodb: {
                        [DbType.Main]: vi.mocked(mongoose).ConnectionStates.connecting,
                        [DbType.Cache]: vi.mocked(mongoose).ConnectionStates.connecting,
                    },
                },
            })
        })

        it('should return op failed status', async () => {
            const databaseService = new DatabaseService('mongo', config, envService, logger)

            vi.spyOn(databaseService, 'createDbConnection').mockResolvedValue({
                connection: {
                    readyState: vi.mocked(mongoose).ConnectionStates.connected,
                    db: { listCollections: vi.fn().mockReturnValue({ toArray: vi.fn().mockRejectedValue('Auth error') }) },
                },
            } as unknown as AppDb)

            await databaseService.onInit()

            expect(await databaseService.onHealthCheck()).toEqual({
                status: HttpStatusCode.SERVICE_UNAVAILABLE,
                details: {
                    mongodb: {
                        [DbType.Main]: DbConnectionStatus.OpFailed,
                        [DbType.Cache]: DbConnectionStatus.OpFailed,
                    },
                },
            })
        })

        it('should return service ok status', async () => {
            const databaseService = new DatabaseService('mongo', config, envService, logger)

            vi.spyOn(databaseService, 'createDbConnection').mockResolvedValue({
                connection: {
                    readyState: vi.mocked(mongoose).ConnectionStates.connected,
                    db: { listCollections: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) },
                },
            } as unknown as AppDb)

            await databaseService.onInit()

            expect(await databaseService.onHealthCheck()).toEqual({
                status: HttpStatusCode.OK,
                details: {
                    mongodb: {
                        [DbType.Main]: vi.mocked(mongoose).ConnectionStates.connected,
                        [DbType.Cache]: vi.mocked(mongoose).ConnectionStates.connected,
                    },
                },
            })
        })
    })

    describe('method: `createDbConnection`', () => {
        const databaseService = new DatabaseService('mongo', config, envService, logger)

        it('should skip db connection creation in case database is disabled', async () => {
            await databaseService.createDbConnection(DbType.Main, { isEnabled: false, database: '', metrics: { enabled: false } })

            expect(logger.info).toHaveBeenCalledWith(`Database is disabled: ${DbType.Main}`)
        })

        it.each([
            [
                'host is provided for cache db type without port',
                DbType.Cache,
                config[DbType.Cache],
                {
                    connection: vi.mocked(mongoose.connection),
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
                    connection: vi.mocked(mongoose.connection),
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
                    connection: vi.mocked(mongoose.connection),
                    connectionOptions: { auth: { password: 'password', username: 'user' }, dbName: 'test', replicaSet: 'rs0' },
                    connectionString: 'mongodb://mongo.replica.test.host:27017/?authSource=admin&readPreference=primary',
                },
                { auth: { password: '********', username: '********' }, dbName: 'test', replicaSet: 'rs0' },
            ],
        ])(
            'should successfully create connection when %s',
            async (_msg, type: DbType, inputConfig: AppDbConfig, expectedConnection, expectedLogOptions) => {
                envService.isTest.mockReturnValue(true)
                ;(vi.mocked(mongoose.set) as any).mockImplementationOnce((_logType: any, logCaller: any): any => {
                    logCaller('coll', 'set', 'db-query', 'doc', {})
                })
                const asPromise = vi.fn()

                vi.mocked(mongoose.createConnection).mockReturnValue({ asPromise } as unknown as Connection)

                asPromise.mockResolvedValue(vi.mocked(mongoose.connection))
                ;(vi.mocked(mongoose.connection).on as any).mockImplementationOnce((_evenType: any, cb: any) => {
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

            await expect(
                databaseService.createDbConnection(DbType.Main, { ...config[DbType.Main], host: 'mongo.test.host' }),
            ).rejects.toEqual(expectedError)
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

    describe('method: `beginTransaction`', () => {
        it('should fail to begin transaction is case there is no connection', async () => {
            const databaseService = new DatabaseService('mongo', config, envService, logger)

            await expect(databaseService.beginTransaction(DbType.Main)).rejects.toEqual(new DatabaseError('Connection is undefined'))
        })

        it('should fail to begin transaction in case error is occurred when starting transaction session', async () => {
            const expectedError = new Error('Unable to start transaction')
            const databaseService = new DatabaseService('mongo', config, envService, logger)
            const sessionMock = {
                startTransaction: vi.fn(),
                abortTransaction: vi.fn(),
                endSession: vi.fn(),
            }

            vi.spyOn(databaseService, 'createDbConnection').mockResolvedValue({
                connection: vi.mocked(mongoose.connection),
            } as unknown as AppDb)
            vi.mocked(mongoose.connection.startSession).mockResolvedValue(sessionMock as unknown as ClientSession)
            vi.mocked(sessionMock.abortTransaction).mockResolvedValueOnce(null)
            vi.mocked(sessionMock.endSession).mockResolvedValueOnce(null)
            vi.mocked(sessionMock.startTransaction).mockImplementationOnce(() => {
                throw expectedError
            })

            await databaseService.onInit()

            await expect(databaseService.beginTransaction()).rejects.toEqual(
                new DatabaseError('Unable to begin transaction', { err: expectedError }),
            )
        })

        it('should successfully begin transaction', async () => {
            const databaseService = new DatabaseService('mongo', config, envService, logger)
            const sessionMock = {
                startTransaction: vi.fn(),
                abortTransaction: vi.fn(),
                endSession: vi.fn(),
            }

            vi.spyOn(databaseService, 'createDbConnection').mockResolvedValue({
                connection: vi.mocked(mongoose.connection),
            } as unknown as AppDb)
            vi.mocked(mongoose.connection.startSession).mockResolvedValue(sessionMock as unknown as ClientSession)
            vi.mocked(sessionMock.abortTransaction).mockResolvedValueOnce(null)
            vi.mocked(sessionMock.endSession).mockResolvedValueOnce(null)
            vi.mocked(sessionMock.startTransaction).mockResolvedValueOnce(sessionMock)

            await databaseService.onInit()
            expect(await databaseService.beginTransaction()).toEqual(sessionMock)
        })
    })
})
