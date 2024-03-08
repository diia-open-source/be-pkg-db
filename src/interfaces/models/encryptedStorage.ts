import { Document } from 'mongoose'

export interface EncryptedStorage {
    data: string
    expiresAt: Date
    source?: unknown
}

export interface EncryptedStorageModel extends EncryptedStorage, Document {}
