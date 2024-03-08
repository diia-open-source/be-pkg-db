import mongoose from 'mongoose'

export interface ReplicaSetNodeConfig {
    replicaHost: string
}

export enum DbType {
    Main = 'main',
    Cache = 'cache',
}

export interface AppDbConfig {
    isEnabled?: boolean
    user?: string
    password?: string
    database?: string
    authSource?: string
    host?: string
    port?: number
    replicaSet?: string
    replicaSetNodes?: ReplicaSetNodeConfig[]
    readPreference?: string
    indexes?: { sync: boolean; exitAfterSync: boolean }
}

export interface AppDb {
    connection: mongoose.Connection
    connectionString: string
    connectionOptions: mongoose.ConnectOptions
}
