# Issue #2698 Investigation Summary

## Problem Statement
tsgo incorrectly reported a circular reference error (TS2456) for valid TypeScript code that TypeScript 6.0 accepts without errors.

### Test Case
```typescript
type Wrap<T> = { [K in keyof T]: T[K] }
type Nav = { config: { screens?: {}; groups?: any } }
type ParamsForScreen<T> = T extends Nav ? StaticParamList<T> : undefined
type ParamListForScreens<S> = { [K in keyof S]: ParamsForScreen<S[K]> }
type ParamListForGroups<G> = G extends {} ? ParamListForScreens<G> : {}
type StaticParamList<T extends Nav> = Wrap<
  ParamListForScreens<T['config']['screens']> & ParamListForGroups<T['config']['groups']>
>
type Test = StaticParamList<{ config: {} }>
```

### Errors Reported by tsgo (INCORRECT)
- Line 5: `TS2315: Type 'StaticParamList' is not generic`
- Line 8: `TS2456: Type alias 'StaticParamList' circularly references itself`
- Line 13: `TS2315: Type 'StaticParamList' is not generic`

### Expected Behavior (TypeScript 6.0)
No errors - the code is valid

## Root Cause

The issue occurred in the type resolution logic when handling generic type aliases that reference themselves with type arguments.

### Execution Flow Leading to Error:

1. Resolver starts processing `StaticParamList` declaration
2. Pushes `StaticParamList` symbol onto resolution stack with `TypeSystemPropertyNameDeclaredType`
3. Begins resolving the type body which eventually processes `ParamsForScreen`
4. `ParamsForScreen` contains conditional type: `T extends Nav ? StaticParamList<T> : undefined`
5. When resolving `StaticParamList<T>` in the conditional:
   - Calls `getTypeFromTypeAliasReference(node, StaticParamList symbol)`
   - This calls `getDeclaredTypeOfSymbol(StaticParamList)` to get base type for instantiation
   - `getDeclaredTypeOfSymbol` calls `getDeclaredTypeOfTypeAlias`
   - `getDeclaredTypeOfTypeAlias` tries to `pushTypeResolution(StaticParamList, DeclaredType)` again
   - `findResolutionCycleStartIndex` finds `StaticParamList` already on stack
   - Returns cycle index, causing circular reference error

### The Key Distinction

There's a fundamental difference between:
- **Resolving a type alias declaration**: Getting the base type structure (happens once)
- **Instantiating a generic type alias**: Creating a concrete type with specific type arguments (can happen many times, is deferred work)

The bug was treating both as the same operation, when in fact:
- `type StaticParamList<T> = ...` ← Declaration resolution
- `StaticParamList<SomeType>` ← Instantiation (NOT circular, just deferred)

## Solution

### Implementation

Added detection for when a generic type alias is being instantiated while its declaration is still being resolved:

1. **New Helper Function**: `isTypeAliasBeingResolved(symbol *ast.Symbol) bool`
   - Checks if symbol is on the resolution stack
   - Checks if `declaredType` is still `nil` (not yet resolved)
   - Returns `true` if currently being resolved, `false` otherwise

2. **Modified `getTypeFromTypeAliasReference`**: 
   - Before calling `getDeclaredTypeOfSymbol`, check if the symbol is being resolved AND has type arguments
   - If yes, return `wildcardType` (a special marker type that defers resolution)
   - This prevents the false circular reference error

3. **Modified `getTypeAliasInstantiation`**:
   - Similar defensive check at the start
   - Returns `wildcardType` if symbol is being resolved
   - Prevents issues if this path is reached

### Why This Works

The `wildcardType` is a special marker in the type system that:
- Allows type resolution to continue without errors
- Defers actual instantiation until the base type is fully resolved
- Is automatically handled correctly by the rest of the type system

When the base type (`StaticParamList` declaration) finishes resolving, subsequent uses of `StaticParamList<T>` will find `declaredType != nil`, skip the check, and instantiate normally.

## Testing Results

### Positive Cases (Should Pass)
✅ Original issue #2698 test case - now passes, matches TypeScript 6.0
✅ Generic type aliases with self-references in conditional types
✅ All existing test suites (5+ minutes of tests)

### Negative Cases (Should Still Error)
✅ Direct circular reference: `type Circular = Circular` - correctly errors
✅ Indirect circular reference: `type A = B; type B = A` - correctly errors
✅ Other circular patterns - still correctly detected

## Impact Assessment

### Benefits
- Fixes false positive circular reference errors
- Aligns tsgo behavior with TypeScript 6.0
- No performance impact (simple check before expensive operation)
- Minimal code changes (< 40 lines)

### Risks
- Low risk: Solution uses existing `wildcardType` mechanism
- Well-tested: All existing tests pass
- Focused: Only affects generic type alias instantiation during declaration resolution

## Files Modified

1. `internal/checker/checker.go`:
   - Added `isTypeAliasBeingResolved()` helper (18 lines)
   - Modified `getTypeFromTypeAliasReference()` (+9 lines)
   - Modified `getTypeAliasInstantiation()` (+9 lines)

2. `INVESTIGATION.md`: Documentation of investigation and solution

## Security Summary

No security vulnerabilities introduced or detected. The changes are purely logical improvements to type resolution that prevent false positive errors.
