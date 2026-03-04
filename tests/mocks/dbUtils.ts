import { drizzle } from 'drizzle-orm/node-postgres'
import { merge } from 'lodash'
import { DateTime } from 'luxon'
import { model } from 'mongoose'

import { buildDbUtilsFn } from '@diia-inhouse/test'

import { DatabaseAdapterType } from '../../src/interfaces/database'
import { Counter, EncryptedStorage } from '../../src/interfaces/models'
import { counterSchema, encryptedStorageSchema } from '../../src/schemas'
import { counter, encryptedStorage } from '../../src/tables'
import * as schema from '../../src/tables'
import { generateIdentifier } from './randomData'

function counterFactory(data: Partial<Counter> = {}): Counter {
    const counterData: Partial<Counter> = {
        code: generateIdentifier(),
        date: DateTime.now().toJSDate(),
        value: 1,
    }

    return merge(counterData, data) as Counter
}

function encryptedStorageFactory(data: Partial<EncryptedStorage> = {}): EncryptedStorage {
    const encryptedStorageData: EncryptedStorage = {
        data: generateIdentifier(),
        expiresAt: DateTime.now().plus({ days: 1 }).toJSDate(),
    }

    return merge(encryptedStorageData, data)
}

const dbUtilsFn = buildDbUtilsFn(
    {
        encryptedStorage: encryptedStorageFactory,
        counter: counterFactory,
    },
    {
        counter: { mongo: model('Counter', counterSchema), postgres: counter },
        encryptedStorage: { mongo: model('EncryptedStorage', encryptedStorageSchema), postgres: encryptedStorage },
    },
)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const dbUtils = () => {
    const databaseAdapter = process.env.DATABASE_ADAPTER as DatabaseAdapterType
    const db = drizzle(process.env.POSTGRES_DATABASE_URL!, { schema, casing: 'snake_case' })

    return dbUtilsFn({ db, databaseAdapter })
}
