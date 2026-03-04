export enum MongodbOperationResult {
    Successful = 'successful',
    Failed = 'failed',
}

export interface DbOpLogEntry {
    database: string
    collection?: string
    opType: string
}

export type DbOpLog = Record<string, DbOpLogEntry>

class MongodbOperationsLabelsMapConcrete {
    operation = ''

    status: MongodbOperationResult = MongodbOperationResult.Successful

    database = ''

    collection = ''
}

export type MongodbOperationsLabelsMap = MongodbOperationsLabelsMapConcrete

export const mongodbOperationsAllowedFields = Object.keys(new MongodbOperationsLabelsMapConcrete()) as (keyof MongodbOperationsLabelsMap)[]

// From 1ms up to 30s
export const mongodbOperationsDefaultBuckets = [
    0.001, 0.003, 0.005, 0.01, 0.015, 0.03, 0.05, 0.07, 0.09, 0.1, 0.15, 0.3, 0.5, 0.7, 0.9, 1, 5, 10, 15, 20, 25, 30,
]
