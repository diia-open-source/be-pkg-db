import { integer, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core'

import { timestamps } from '../postgresUtils'

export const counter = pgTable(
    'counter',
    {
        code: varchar().notNull(),
        value: integer().notNull(),
        date: timestamp().notNull(),
        ...timestamps,
    },
    (table) => [unique('counter_code_date_idx').on(table.code, table.date)],
)
