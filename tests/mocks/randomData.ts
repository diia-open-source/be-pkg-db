import { randomBytes } from 'node:crypto'

export function generateIdentifier(length = 12): string {
    return randomBytes(length).toString('hex')
}
