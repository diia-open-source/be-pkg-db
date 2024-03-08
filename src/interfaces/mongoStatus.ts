import { DbType } from './dbConfig'

export enum DbConnectionStatus {
    Disconnected = 'disconnected',
    Connected = 'connected',
    Connecting = 'connecting',
    Disconnecting = 'disconnecting',
}

export type DbStatusByType = Partial<Record<DbType, DbConnectionStatus>>

export type MongoDbStatus = { mongodb: DbStatusByType }
