/* eslint-disable @typescript-eslint/no-explicit-any */
import { integer, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core'

import { timestamps } from '../postgresUtils.js'

export const counter: any = pgTable(
    'counter',
    {
        code: varchar().notNull(),
        value: integer().notNull(),
        date: timestamp().notNull(),
        ...timestamps,
    },
    (table) => [unique('counter_code_date_idx').on(table.code, table.date)],
)
