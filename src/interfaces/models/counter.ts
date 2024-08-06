import { Document } from 'mongoose'

export interface Counter {
    code: string
    value: number
    date?: Date
}

export interface CounterModel extends Counter, Document {}
