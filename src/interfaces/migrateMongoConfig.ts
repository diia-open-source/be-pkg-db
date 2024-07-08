import { mongo } from 'mongoose'

export interface MigrateMongoConfig {
    mongodb: {
        url: Parameters<(typeof mongo.MongoClient)['connect']>[0]
        databaseName?: mongo.Db['databaseName']
        options?: mongo.MongoClientOptions
    }
    migrationsDir?: string
    changelogCollectionName: string
    migrationFileExtension?: string
    useFileHash?: boolean
    moduleSystem: string
}
