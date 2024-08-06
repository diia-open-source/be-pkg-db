import { Model, Schema, model, models } from 'mongoose'

import { Counter } from '../interfaces/models/counter'

const counterSchema = new Schema<Counter>(
    {
        code: { type: String, required: true },
        value: { type: Number, required: true },
        date: { type: Date },
    },
    {
        timestamps: true,
    },
)

counterSchema.index({ code: 1, date: -1 }, { unique: true })

export default <Model<Counter>>models.Counter || model('Counter', counterSchema)
