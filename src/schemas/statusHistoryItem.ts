import { Schema } from 'mongoose'

import { StatusHistoryItem } from '@diia-inhouse/types'

export function createStatusHistoryItemSchema(statuses: string[]): Schema<StatusHistoryItem<string>> {
    return new Schema<StatusHistoryItem<string>>(
        {
            traceId: { type: String },
            date: { type: Date, required: true },
            status: { type: String, enum: statuses, required: true },
        },
        { _id: false },
    )
}
