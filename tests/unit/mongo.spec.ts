import { UnprocessableEntityError } from '@diia-inhouse/errors'

import { MongoHelper } from '../../src'
import { generateIdentifier } from '../mocks/randomData'

describe('MongoHelper', () => {
    describe('method: `buildMongoUrl`', () => {
        it('should successfully build mongo url', () => {
            process.env.MONGO_USER = 'user'
            process.env.MONGO_PASSWORD = 'password'
            process.env.MONGO_HOST = 'mongo.host'
            process.env.MONGO_PORT = '27017'
            process.env.MONGO_AUTH_SOURCE = 'admin'
            process.env.MONGO_REPLICA_SET = 'rs0'

            expect(MongoHelper.buildMongoUrl()).toBe('mongodb://user:password@mongo.host:27017/admin?replicaSet=rs0')
        })
    })

    describe('method: `getMongoErrorDupField`', () => {
        it('should return field in case it is present in error message about duplication', () => {
            expect(MongoHelper.getMongoErrorDupField('Field identifier_1 dup key', ['identifier'])).toBe('identifier')
        })
    })

    describe('method: `handleMongoUniqError`', () => {
        const identifier = generateIdentifier()

        it.each([
            ['regular database', new Error('Unable to fetch'), {}, [], 'user', new Error('Error: Unable to fetch')],
            [
                'unexpected while entity processing',
                <Error>{ name: 'MongoError', code: 11000, message: 'Not found' },
                { identifier },
                ['identifier'],
                'user',
                new Error('Unexpected error while entity processing. Not found'),
            ],
            [
                'already exists',
                <Error>{ name: 'MongoError', code: 11000, message: 'Field identifier_1 dup key' },
                { identifier },
                ['identifier'],
                'user',
                new UnprocessableEntityError(`user with identifier '${identifier}' already exists`, {
                    field: 'identifier',
                    message: 'identifier field unique constraint',
                    type: 'unique',
                    value: identifier,
                }),
            ],
        ])('should throw %s error', (_msg, inputError, params, uniqFieldNames, modelName, expectedError) => {
            expect(() => {
                MongoHelper.handleMongoUniqError(inputError, params, uniqFieldNames, modelName)
            }).toThrow(expectedError)
        })
    })
})
