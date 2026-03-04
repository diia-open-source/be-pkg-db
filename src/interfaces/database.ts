import { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../tables'

export type DatabaseAdapterType = 'mongo' | 'postgres'

export type DerivedRepository<TRepository> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [K in keyof TRepository]: TRepository[K] extends (...args: any[]) => any ? TRepository[K] : never
}

export type PostgresDatabase = NodePgDatabase<typeof schema>

export type DatabaseAdapter<T extends DatabaseAdapterType, Repositories extends Record<DatabaseAdapterType, unknown>> = Repositories[T]
