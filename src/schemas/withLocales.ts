import { Schema, SchemaDefinition } from 'mongoose'

import { Languages, WithLocales } from '@diia-inhouse/types'

export function withLocales<T>(localeSchema: Schema<T>): SchemaDefinition<WithLocales<T>> {
    const localesSchemaDefinition: SchemaDefinition = {}

    for (const language of Object.values(Languages)) {
        localesSchemaDefinition[language] = { type: localeSchema, required: language === Languages.Uk }
    }

    const localesSchema = new Schema<WithLocales<T>['locales']>(localesSchemaDefinition, { _id: false })

    return {
        locales: { type: localesSchema, required: true },
    }
}
