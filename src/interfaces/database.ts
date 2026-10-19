import { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { mongo } from 'mongoose'

import * as schema from '../tables/index.js'

export type DatabaseAdapterType = 'mongo' | 'postgres'

export type DerivedRepository<TRepository> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [K in keyof TRepository]: TRepository[K] extends (...args: any[]) => any ? TRepository[K] : never
}

export type PostgresDatabase = NodePgDatabase<typeof schema>

export type DatabaseAdapter<T extends DatabaseAdapterType, Repositories extends Record<DatabaseAdapterType, unknown>> = Repositories[T]

export interface WithTransactionOptions extends mongo.TransactionOptions {
    /**
     * Max number of callback re-runs after a TransientTransactionError (total attempts = retries + 1).
     * When exhausted, throws DatabaseError "Failed to complete transaction. No retries left".
     * When omitted, retries are limited only by the given timeout (`timeoutMS`, or the driver's 120s default).
     */
    retries?: number
    /**
     * Configures a timeoutMS expiry for the entire withTransactionCallback.
     *
     * @remarks
     * - The remaining timeout will not be applied to callback operations that do not use the ClientSession.
     * - Overriding timeoutMS for operations executed using the explicit session inside the provided callback will result in a client-side error.
     * - It works together with `retries`: whichever runs out first ends the transaction.
     */
    timeoutMS?: number
}
