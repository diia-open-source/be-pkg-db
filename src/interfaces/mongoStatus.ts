import { DbType } from './dbConfig'

export enum DbConnectionStatus {
    Disconnected = 'disconnected',
    Connected = 'connected',
    Connecting = 'connecting',
    Disconnecting = 'disconnecting',
    OpFailed = 'op_failed',
}

export type DbStatusByType = Partial<Record<DbType, DbConnectionStatus>>

export type MongoDbStatus = { mongodb: DbStatusByType }
