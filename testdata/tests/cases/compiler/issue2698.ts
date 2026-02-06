// @noImplicitAny: true

type Wrap<T> = { [K in keyof T]: T[K] }
type Nav = { config: { screens?: {}; groups?: any } }
type ParamsForScreen<T> = T extends Nav ? StaticParamList<T> : undefined
type ParamListForScreens<S> = { [K in keyof S]: ParamsForScreen<S[K]> }
type ParamListForGroups<G> = G extends {} ? ParamListForScreens<G> : {}
type StaticParamList<T extends Nav> = Wrap<
  ParamListForScreens<T['config']['screens']> & ParamListForGroups<T['config']['groups']>
>

// Usage to trigger errors
type Test = StaticParamList<{ config: {} }>
