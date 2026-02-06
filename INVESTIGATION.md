# Investigation: Issue 2698 - False Positive Circular Reference

## Problem
tsgo reports a circular reference error for code that TypeScript 6.0 accepts:

```typescript
type StaticParamList<T extends Nav> = Wrap<...>
type ParamsForScreen<T> = T extends Nav ? StaticParamList<T> : undefined
```

When resolving `StaticParamList`, we encounter `StaticParamList<T>` in the conditional type.

## Root Cause Analysis

### Call Stack When Error Occurs:
1. `getDeclaredTypeOfTypeAlias(StaticParamList)` - pushes symbol onto resolution stack
2. `getTypeFromTypeNode` - resolves the body
3. Eventually reaches `ParamsForScreen` which has conditional type
4. Conditional type has `StaticParamList<T>` as true branch
5. `getTypeFromTypeAliasReference(StaticParamList)` is called
6. Calls `getDeclaredTypeOfSymbol(StaticParamList)` at line 23026
7. `getDeclaredTypeOfTypeAlias(StaticParamList)` tries to push symbol again
8. `pushTypeResolution` calls `findResolutionCycleStartIndex`
9. Finds `StaticParamList` already on stack → reports circular reference ERROR!

### Key Insight
The error occurs because when resolving a generic type alias, if we encounter a reference to that same alias with type arguments (e.g., `StaticParamList<T>`), we try to call `getDeclaredTypeOfSymbol` again. This triggers the circular reference detector even though we're just trying to instantiate with type arguments, not resolve the declaration again.

The critical distinction:
- **Resolving the declared type**: `type StaticParamList<T> = ...` (needs to complete once)
- **Instantiating with type arguments**: `StaticParamList<T>` (deferred work that waits for declared type)

These are fundamentally different operations, but the original code treated them the same.

## Solution

Added a check to detect when a generic type alias is being instantiated while its base declaration is still being resolved:

1. **New helper function `isTypeAliasBeingResolved`**: Checks if a type alias symbol is on the resolution stack but hasn't completed resolution yet (declaredType is nil).

2. **Early return in `getTypeFromTypeAliasReference`**: Before calling `getDeclaredTypeOfSymbol`, check if the symbol is being resolved and has type arguments. If so, return `wildcardType` to defer the instantiation.

3. **Early return in `getTypeAliasInstantiation`**: Similarly check and return `wildcardType` if needed (defensive measure).

The `wildcardType` is a special marker type that allows type resolution to continue without triggering the circular reference detector. The actual instantiation will happen later once the base type is fully resolved.

## Testing

### Test Cases Verified:
1. ✅ Original issue 2698 - no false positive error
2. ✅ Actual circular references still detected: `type Circular = Circular`
3. ✅ Indirect circular references detected: `type A = B; type B = A`
4. ✅ All existing test suites pass

### Comparison with TypeScript 6.0:
Both tsgo and TypeScript 6.0 now report no errors for the test case, confirming the fix aligns with TypeScript's behavior.

