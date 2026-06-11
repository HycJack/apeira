import type { ResponsesOptions } from '@xsai-ext/responses'

export type DeepReadonly<T>
  = T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer U)[]
      ? readonly DeepReadonly<U>[]
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T

export type ItemParam = Exclude<ResponsesOptions['input'], string>[number]

export type MaybePromise<T> = Promise<T> | T
