import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import mongoose from 'mongoose'
import { mock } from 'vitest-mock-extended'

import { DiiaLogger } from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { DurationMs, Logger } from '@diia-inhouse/types'

import { CleanupExpiredDataCommand } from '../../src/cli/cleanupExpiredData'
import { RunMigrationCommand } from '../../src/cli/runMigration'
import { SyncIndexesCommand } from '../../src/cli/syncIndexes'
import { DatabaseAdapterType } from '../../src/interfaces'
import { DatabaseService } from '../../src/services/database'
import * as tables from '../../src/tables'
import { getConfig } from '../utils'

const databaseAdapter = process.env.DATABASE_ADAPTER as DatabaseAdapterType
const mongooseUrl = import.meta.resolve('mongoose')
const tablesUrl = pathToFileURL(path.resolve('src/tables/index.ts')).href

// The commands resolve their paths against the working directory (`./dist/<dir>`, `./<script>`), as they do when a
// service runs them from its root, so every test works in a fresh directory of generated files.
function writeFile(root: string, relativePath: string, content: string): void {
    const filePath = path.join(root, relativePath)

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mkdirSync(path.dirname(filePath), { recursive: true })
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(filePath, content)
}

function modelSource(collectionName: string, extra = ''): string {
    return [
        `import { Schema, model } from '${mongooseUrl}'`,
        `const schema = new Schema({ code: String }, { autoIndex: false })`,
        `schema.index({ code: 1 }, { unique: true })`,
        `export default model('${collectionName}', schema, '${collectionName}')`,
        extra,
    ].join('\n')
}

function changelog(): mongoose.mongo.Collection {
    return mongoose.connection.collection('migrations-history')
}

function getMigrationCommand(logger: Logger = mock<Logger>()): RunMigrationCommand {
    return new RunMigrationCommand(logger, mongoose.connection.db!, mongoose.connection.getClient())
}

function writeMigration(root: string, fileName: string, body: string): string {
    writeFile(root, `migrations/${fileName}.mjs`, body)

    return `migrations/${fileName}.mjs`
}

describe('CLI commands', () => {
    const originalCwd = process.cwd()
    let workDir: string

    beforeEach(() => {
        workDir = mkdtempSync(path.join(tmpdir(), 'pkg-db-cli-'))
        process.chdir(workDir)
    })

    afterEach(() => {
        process.chdir(originalCwd)
        rmSync(workDir, { recursive: true, force: true })
    })

    describe.runIf(databaseAdapter === 'mongo')('mongo', () => {
        const databaseLogger = new DiiaLogger()
        const databaseService = new DatabaseService('mongo', getConfig().db, new EnvService(databaseLogger), databaseLogger)

        beforeAll(async () => {
            await databaseService.onInit()
        })

        afterAll(async () => {
            await databaseService.onDestroy()
        })

        describe('sync-indexes', () => {
            it('should fail when the models directory is absent', async () => {
                // Act & Assert
                await expect(new SyncIndexesCommand(mock<Logger>()).run('models')).rejects.toThrow('Models dir is absent: ./dist/models')
            })

            it('should make every model collection match its schema indexes', async () => {
                // Arrange
                const synced = `cli_synced_${randomUUID()}`
                const skipped = `cli_skipped_${randomUUID()}`

                writeFile(workDir, 'dist/models/synced.js', modelSource(synced))
                writeFile(workDir, 'dist/models/skipped.js', modelSource(skipped, 'export const skipSyncIndexes = true'))
                writeFile(workDir, 'dist/models/index.js', `throw new Error('index.js must not be loaded')`)
                writeFile(workDir, 'dist/models/schemas/user.js', `throw new Error('schemas must not be loaded')`)

                const syncedCollection = mongoose.connection.collection(synced)
                const skippedCollection = mongoose.connection.collection(skipped)

                await syncedCollection.createIndex({ stale: 1 })
                await skippedCollection.createIndex({ stale: 1 })

                // Act
                await new SyncIndexesCommand(mock<Logger>()).run('models')

                // Assert
                const syncedIndexes = await syncedCollection.indexes()
                const skippedIndexes = await skippedCollection.indexes()

                expect(syncedIndexes).toHaveLength(2)
                expect(syncedIndexes).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ name: '_id_' }),
                        expect.objectContaining({ name: 'code_1', unique: true }),
                    ]),
                )
                expect(skippedIndexes).toHaveLength(2)
                expect(skippedIndexes).toEqual(
                    expect.arrayContaining([expect.objectContaining({ name: '_id_' }), expect.objectContaining({ name: 'stale_1' })]),
                )

                await syncedCollection.drop()
                await skippedCollection.drop()
            })
        })

        describe('migrate', () => {
            it('should skip a script that does not exist', async () => {
                // Arrange
                const logger = mock<Logger>()
                const fileName = `missing-${randomUUID()}`

                // Act
                await getMigrationCommand(logger).run(`migrations/${fileName}.mjs`)

                // Assert
                expect(logger.info).toHaveBeenCalledWith('Script not found under provided path', {
                    scriptPath: `./migrations/${fileName}.mjs`,
                })
                expect(await changelog().countDocuments({ fileName })).toBe(0)
            })

            it.each([
                { direction: 'up', execDown: false },
                { direction: 'down', execDown: true },
            ])('should run the $direction function and record it as done', async ({ direction, execDown }) => {
                // Arrange
                const fileName = `migration-${randomUUID()}`
                const target = `cli_migration_${randomUUID()}`
                const scriptPath = writeMigration(
                    workDir,
                    fileName,
                    [
                        `export async function up(db) { await db.collection('${target}').insertOne({ ran: 'up' }) }`,
                        `export async function down(db) { await db.collection('${target}').insertOne({ ran: 'down' }) }`,
                    ].join('\n'),
                )

                // Act
                await getMigrationCommand().run(scriptPath, execDown)

                // Assert
                expect(
                    await mongoose.connection
                        .collection(target)
                        .find({}, { projection: { _id: 0 } })
                        .toArray(),
                ).toEqual([{ ran: direction }])
                expect(await changelog().findOne({ fileName })).toMatchObject({
                    fileName,
                    type: direction,
                    status: 'DONE',
                    duration: expect.any(Number),
                    startedAt: expect.any(Date),
                    endedAt: expect.any(Date),
                })

                await mongoose.connection.collection(target).drop()
            })

            it.each([
                {
                    direction: 'up',
                    execDown: false,
                    body: 'export async function down() {}',
                    error: `Migration script is missing 'up' function.`,
                },
                {
                    direction: 'down',
                    execDown: true,
                    body: 'export async function up() {}',
                    error: `Migration script is missing 'down' function.`,
                },
                {
                    direction: 'up',
                    execDown: false,
                    body: `export async function up() { throw new Error('migration broke') }`,
                    error: 'migration broke',
                },
            ])('should record a failed $direction run and rethrow: $error', async ({ direction, execDown, body, error }) => {
                // Arrange
                const fileName = `migration-${randomUUID()}`
                const scriptPath = writeMigration(workDir, fileName, body)

                // Act & Assert
                await expect(getMigrationCommand().run(scriptPath, execDown)).rejects.toThrow(error)
                expect(await changelog().findOne({ fileName })).toMatchObject({ fileName, type: direction, status: 'FAILED' })
            })
        })
    })

    describe('pg-cleanup-expired-data', () => {
        it('should do nothing when the schemas path does not exist', async () => {
            // Arrange
            const logger = mock<Logger>()

            // Act
            await new CleanupExpiredDataCommand(logger).run('db/schemas/index.js')

            // Assert
            expect(logger.info).toHaveBeenCalledWith('Pg schemas not found under provided path', { schemasPath: 'db/schemas/index.js' })
        })

        it('should do nothing when no table has an expiring column', async () => {
            // Arrange
            const logger = mock<Logger>()

            writeFile(workDir, 'dist/db/schemas/index.mjs', `export { counter } from '${tablesUrl}'`)

            // Act
            await new CleanupExpiredDataCommand(logger).run('db/schemas/index.mjs')

            // Assert
            expect(logger.info).toHaveBeenCalledWith('No tables with expiring data found')
        })

        describe.runIf(databaseAdapter === 'postgres')('postgres', () => {
            it('should delete only the rows past their expiry', async () => {
                // Arrange
                const db = drizzle(process.env.POSTGRES_DATABASE_URL!, { casing: 'snake_case', schema: tables })
                const now = Date.now()
                const [expired, fresh] = await db
                    .insert(tables.encryptedStorage)
                    .values([
                        { data: 'expired', expiresAt: new Date(now - 2 * DurationMs.Day) },
                        { data: 'fresh', expiresAt: new Date(now) },
                    ])
                    .returning({ id: tables.encryptedStorage.id })

                writeFile(workDir, 'dist/db/schemas/index.mjs', `export { counter, encryptedStorage } from '${tablesUrl}'`)

                // Act
                await new CleanupExpiredDataCommand(mock<Logger>()).run('db/schemas/index.mjs')

                // Assert
                const remaining = (await db.select({ id: tables.encryptedStorage.id }).from(tables.encryptedStorage)).map(({ id }) => id)

                expect(remaining).not.toContain(expired.id)
                expect(remaining).toContain(fresh.id)

                await db.$client.end()
            })
        })
    })
})
