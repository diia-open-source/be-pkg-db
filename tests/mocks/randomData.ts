import { randomBytes } from 'crypto'

export function generateIdentifier(length = 12): string {
    return randomBytes(length).toString('hex')
}
