import { Schema, model } from 'mongoose'

import { Languages, WithLocales } from '@diia-inhouse/types'

import { withLocales } from '../../../src'

interface TemplateLocale {
    text: string
}

interface Template extends WithLocales<TemplateLocale> {
    code: string
}

describe('withLocales', () => {
    const templateLocaleSchema = new Schema<TemplateLocale>({ text: { type: String, required: true } }, { _id: false })
    const templateModel = model<Template>(
        'WithLocalesTemplate',
        new Schema<Template>({
            code: { type: String, required: true },
            ...withLocales(templateLocaleSchema),
        }),
    )

    it.each([
        { description: 'only Ukrainian locale', locales: { [Languages.Uk]: { text: 'текст' } } },
        { description: 'all locales', locales: { [Languages.Uk]: { text: 'текст' }, [Languages.En]: { text: 'text' } } },
    ])('should pass validation with $description', async ({ locales }) => {
        await expect(new templateModel({ code: 'code', locales }).validate()).resolves.toBeUndefined()
    })

    it.each([
        { description: 'locales are missing', locales: undefined, path: 'locales' },
        { description: 'Ukrainian locale is missing', locales: { [Languages.En]: { text: 'text' } }, path: `locales.${Languages.Uk}` },
        {
            description: 'locale is invalid',
            locales: { [Languages.Uk]: { text: 'текст' }, [Languages.En]: {} },
            path: `locales.${Languages.En}.text`,
        },
    ])('should fail validation when $description', async ({ locales, path }) => {
        await expect(new templateModel({ code: 'code', locales }).validate()).rejects.toMatchObject({
            errors: { [path]: expect.anything() },
        })
    })
})
