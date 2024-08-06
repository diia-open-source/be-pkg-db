import { DateTime } from 'luxon'

import counterModel from '../models/counter'

export class CounterService {
    async getNextValue(code: string): Promise<number> {
        const { value } = await counterModel.findOneAndUpdate({ code }, { $inc: { value: 1 } }, { new: true, upsert: true })

        return value
    }

    async getNextDailyValue(code: string): Promise<number> {
        const { value } = await counterModel.findOneAndUpdate(
            { code, date: DateTime.now().startOf('day').toJSDate() },
            { $inc: { value: 1 } },
            { new: true, upsert: true },
        )

        return value
    }
}
