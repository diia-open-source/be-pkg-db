import { existsSync } from 'node:fs'
import path from 'node:path'

import { lt, sql } from 'drizzle-orm'
import { NodePgClient, NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres'
import { PgColumn, PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import { register } from 'ts-node'

import { Logger } from '@diia-inhouse/types'

register()

interface ExpiringColumn {
    column: PgColumn
    expireAfterSeconds: number
}

interface ExpiringTable {
    name: string
    tableName: string
    expiringColumns: ExpiringColumn[]
}

export class CleanupExpiredDataCommand {
    constructor(private readonly logger: Logger) {}

    async run(filePath: string): Promise<void> {
        const schema = await this.loadSchema(filePath)
        if (!schema) {
            this.logger.info('Pg schemas not found under provided path', { schemasPath: filePath })

            return
        }

        const db = this.createDbConnection(schema)
        const expiringTables = this.findExpiringTables(schema)

        if (expiringTables.length === 0) {
            this.logger.info('No tables with expiring data found')

            return
        }

        await this.cleanupTables(db, schema, expiringTables)

        await (db.$client as Pool).end()
    }

    private async loadSchema(filePath: string): Promise<Record<string, PgTable> | undefined> {
        const schemaPath = `./dist/${filePath}`
        const fullSchemaPath = path.resolve(schemaPath)
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const isExistsSync = existsSync(fullSchemaPath) // nosemgrep: eslint.detect-non-literal-fs-filename

        if (!isExistsSync) {
            return
        }

        return await import(fullSchemaPath)
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    private createDbConnection(schema: Record<string, PgTable>) {
        return drizzle(process.env.POSTGRES_DATABASE_URL!, {
            schema,
            casing: 'snake_case',
            logger: true,
        }) as unknown as NodePgDatabase & { $client: NodePgClient }
    }

    private async cleanupTables(db: NodePgDatabase, schema: Record<string, PgTable>, expiringTables: ExpiringTable[]): Promise<void> {
        this.logger.info(`Found ${expiringTables.length} tables with expiring data: ${expiringTables.map(({ name }) => name).join(', ')}`)
        const startTime = Date.now()

        try {
            for (const { name, tableName, expiringColumns } of expiringTables) {
                this.logger.info(`Starting cleanup expired data from table: ${name}`)
                const table = schema[tableName]

                for (const { column, expireAfterSeconds } of expiringColumns) {
                    const result = await db
                        .delete(table)
                        .where(lt(sql.raw(`"${name}"."${column.name}" + interval '${expireAfterSeconds} seconds'`), new Date()))

                    this.logger.info(
                        `Deleted ${result.rowCount} rows from table ${name} by column ${column.name} with expireAfterSeconds ${expireAfterSeconds}`,
                    )
                }
            }

            this.logger.info(`Cleanup expired data finished! It took ${((Date.now() - startTime) / 1000).toFixed(1)} seconds`)
        } catch (err) {
            this.logger.error('Failed to cleanup expired data', { err })
            throw err
        }
    }

    private findExpiringTables(schemas: Record<string, PgTable>): ExpiringTable[] {
        const tables = Object.entries(schemas)
            .filter(([, table]) => table?.constructor?.name === 'PgTable')
            .map(([tableName, table]) => ({
                ...getTableConfig(table),
                tableName,
            }))

        const expiringTables: ExpiringTable[] = []

        for (const table of tables) {
            const expiringColumns = table.columns
                .filter((column) => this.isExpiringColumn(column as unknown as PgColumn))
                .map((column) => ({
                    column: column as unknown as PgColumn,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    expireAfterSeconds: (column['config'] as any).fieldConfig.expireAfterSeconds,
                }))

            if (expiringColumns.length > 0) {
                expiringTables.push({ ...table, expiringColumns })
            }
        }

        return expiringTables
    }

    private isExpiringColumn(column: PgColumn): boolean {
        if (column.columnType !== 'PgCustomColumn') {
            return false
        }

        const config = column['config'] as unknown as { fieldConfig: { expireAfterSeconds: number } }

        return typeof config?.fieldConfig?.expireAfterSeconds === 'number'
    }
}
