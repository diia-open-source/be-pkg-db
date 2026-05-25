import { Schema } from 'mongoose'

import { Counter } from '../interfaces/models/counter.js'

const counterSchema: Schema<Counter> = new Schema<Counter>(
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

export { counterSchema }
