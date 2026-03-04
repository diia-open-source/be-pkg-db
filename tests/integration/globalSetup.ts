/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module'

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getConfig } from 'tests/utils'

import * as schema from '../../src/tables'

const require = createRequire(import.meta.url)
const config = getConfig()

export default async (): Promise<void> => {
    if (config.databaseAdapter !== 'postgres') {
        return
    }

    // workaround for https://github.com/drizzle-team/drizzle-orm/issues/2853
    const { pushSchema } = require('drizzle-kit/api') as { pushSchema: typeof import('drizzle-kit/api').pushSchema }

    // connect to default database 'postgres' and create a new database for tests if it doesn't exist
    const dbName = config.postgresConfig.url.split('/').pop()!
    const connectionString = config.postgresConfig.url.replace(`/${dbName}`, ``)
    const connection = new Pool({ connectionString, max: 1 })

    const client = await connection.connect()
    const dbExists = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`)

    if (!dbExists.rowCount) {
        await client.query(`CREATE DATABASE ${dbName}`)
    }

    client.release()
    await connection.end()

    // connect to the new database to apply schema and truncate tables
    const db = drizzle(config.postgresConfig.url, { schema, casing: 'snake_case' })

    const tables = Object.values(db._.schema ?? {}).map((table) => table.dbName)

    // truncate all tables in the database
    for (const table of tables) {
        const tableExists = await db.execute(
            sql.raw(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}')`),
        )

        if (tableExists.rows[0].exists) {
            await db.execute(sql.raw(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`))
        }
    }

    // apply table schema using push https://orm.drizzle.team/docs/drizzle-kit-push
    const { apply } = await pushSchema(schema, db as any)

    await apply()

    // manually add unique constraint to counter table (drizzle-kit push doesn't support it)
    await db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'counter_code_date_idx'
        ) THEN
          ALTER TABLE counter ADD CONSTRAINT counter_code_date_idx UNIQUE (code, date);
        END IF;
      END $$;
    `)

    await (db.$client as Pool).end()
}
