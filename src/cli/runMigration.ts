import { existsSync } from 'node:fs'
import path from 'node:path'

import { register } from 'ts-node'

import { Logger } from '@diia-inhouse/types'

import { mongo } from '../interfaces'

register()

export class RunMigrationCommand {
    private readonly changelogCollectionName = 'migrations-history'

    constructor(
        private readonly logger: Logger,
        private readonly db: mongo.Db,
        private readonly client: mongo.MongoClient,
    ) {}

    async run(filePath: string, execDown = false): Promise<void> {
        const scriptPath = `./${filePath}`
        const fileName = path.parse(scriptPath).name
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const isExistsSync = existsSync(scriptPath) // nosemgrep: eslint.detect-non-literal-fs-filename

        if (!isExistsSync) {
            this.logger.info('Script not found under provided path', { scriptPath })

            return
        }

        const startTime = Date.now()
        const execScriptName = execDown ? 'down' : 'up'

        const modelModule = await import(path.resolve(scriptPath))
        const { up, down } = modelModule

        this.logger.info(`Starting migration ${execScriptName}: ${fileName}`)

        try {
            if (execDown) {
                if (!down) {
                    throw new Error(`Migration script is missing 'down' function.`)
                }

                await down(this.db, this.client)
            } else {
                if (!up) {
                    throw new Error(`Migration script is missing 'up' function.`)
                }

                await up(this.db, this.client)
            }

            this.logger.info(`Migration script finished! It took ${((Date.now() - startTime) / 1000).toFixed(1)} seconds`)
        } catch (err) {
            this.logger.error(`Couldn't migrate ${execScriptName}: ${fileName}`)

            await this.updateChangeLog(startTime, fileName, execScriptName, true)

            throw err
        }

        await this.updateChangeLog(startTime, fileName, execScriptName)
    }

    private async updateChangeLog(startTime: number, fileName: string, type: string, isFailed?: boolean): Promise<void> {
        const changelogCollection = this.db.collection(this.changelogCollectionName)

        const startedAt = new Date(startTime)
        const endedAt = new Date()
        const duration = Math.ceil((Date.now() - startTime) / 1000)
        const status = isFailed ? 'FAILED' : 'DONE'

        try {
            await changelogCollection.insertOne({ fileName, type, duration, startedAt, endedAt, status })
        } catch (err) {
            this.logger.error(`Couldn't update changelog: ${(err as Error).message}`)

            throw err
        }
    }
}
