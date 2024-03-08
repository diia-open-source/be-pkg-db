import { Model, Schema, model, models } from 'mongoose'

import { DurationS } from '@diia-inhouse/types'

import { EncryptedStorage } from '../interfaces/models/encryptedStorage'

const encryptedStorageSchema = new Schema<EncryptedStorage>(
    {
        data: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        source: { type: {} },
    },
    {
        timestamps: true,
    },
)

encryptedStorageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: DurationS.Day })

export default <Model<EncryptedStorage>>models.EncryptedStorage || model('EncryptedStorage', encryptedStorageSchema)
