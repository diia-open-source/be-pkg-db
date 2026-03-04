import { existsSync } from 'node:fs'
import path from 'node:path'

import mongoose from 'mongoose'
import recursiveRead from 'recursive-readdir'

import { Logger } from '@diia-inhouse/types'

export class SyncIndexesCommand {
    constructor(private readonly logger: Logger) {}

    async run(modelsDir: string): Promise<void> {
        const modelsPath = `./dist/${modelsDir}`
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const isExistsSync = existsSync(modelsPath) // nosemgrep: eslint.detect-non-literal-fs-filename

        if (!isExistsSync) {
            throw new Error(`Models dir is absent: ${modelsPath}`)
        }

        const t0 = Date.now()

        this.logger.info('Start syncing indexes')
        const files = await recursiveRead(modelsPath, ['*.map', 'index.js', 'schemas', '*.types.js'])
        const tasks = []
        for (const fileName of files) {
            const modelModule = await import(path.resolve(fileName))
            if (modelModule.skipSyncIndexes) {
                continue
            }

            const task = modelModule.default

            tasks.push(this.syncModel(task))
        }

        await Promise.all(tasks)
        this.logger.info(`Ended syncing indexes in ${Date.now() - t0} ms`)
    }

    private async syncModel(model: mongoose.Model<unknown>): Promise<void> {
        const t0 = Date.now()

        this.logger.info(`Start syncing indexes for the ${model.modelName} collection`)
        await model.syncIndexes()
        this.logger.info(`Ended syncing indexes for the ${model.modelName} collection in ${Date.now() - t0} ms`)
    }
}
