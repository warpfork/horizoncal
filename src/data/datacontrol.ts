
/*
Data Readiness Levels
=====================

There are roughly three levels of data-knowingness:

- raw, "any", "unknown" data.
- primitive data, with some known basic type (string, number, etc).
- parsed, reified, structured data.

Raw data is what you have when you're either processing serial data,
or receiving unknown javascript values.
(Be wary of handling this with 'any' in Typescript; 'any' disables type checking *entirely*,
and in an infectious (!) way -- prefer using 'unknown' as a type instead.)

We define "primitive" data as something that's got at least one step more useful type info than "unknown",
and is also generally understood to be something that's still clearly directly serializable in a format like JSON or YAML.
Thus, "primitive" data means: a string, a number, a boolean... or a list of only such things, or a map of only such things.
(We don't consider a type with complex methods on it or additional serialization logic to count as "primitive" -- that's _reified_ data.)

Reified data is full objects, perhaps with methods, etc.
Reified data doesn't tacitly guarantee itself to trivially serializable;
it might have sometransformation back to primitive data, but that transformation is a function.

We define these three levels because we store and handle all three of them.
They have different uses:

- "unknown" data is... simply often unavoidable, in javascript;
- "primitive" data is useful to work with because it's serialization-ready,
   and also any information you get from the DOM tends to be at this level;
- "structured" data can be useful to keep in memory for rapid access.

Validity is orthagonal to these levels.
One can have primitive, but invalid, data.


Control stores primitive and structured data, and handles unknown data.
----------------------------------------------------------------------

The `Control` type stores data and associates it with validation functions.

`Control` stores:

- _both_ primitive _and_ structured forms,
- as well as a validity boolean,
- as well as any error reported by validation.

This design aims to keep both structured easy-to-use data at hand,
while also _always_ having the primitive data at hand as well.

Generally, Control makes data is always accessible... regardless of whether or not it's valid.
This is because we assume you don't want to throw user input away, even if it needs correction.
Make sure to check for the presence of error values before persisting any data from the Control.

If you want to start from totally `unknown` data, there are functions for that too...
but these may (unfortunately, unavoidably) make the Control harder to use,
because if some given 'unknown' data can't be brought up to even TPrimitive type,
then we've got problems -- we certainly want the value accessor methods to return
results of the generic types you asked them too, but we _also_ certainly don't want to
those accessor methods leak unlawful/incorrectly-typed behavior into the rest of your code.
In these situations, we have accessor methods for the primitive and structured data
throw errors, rather than leak unlawful/incorrectly-typed behavior into the rest of your code.


Control always forces you to come from primitive data.
------------------------------------------------------

The `Control` type doesn't bother to have a function that goes from reified to primitive,
because in this application, it just plain hasn't been necessary:
our information is pretty much always coming from the primitive form --
either as its loaded from files,
or as it it's given to us from the user via some DOM elements.

So why bother with code complexity in the form of transforms back from structured to primitive?

*/


// Control stores a value and associates it with validation functions.
// Optionally, it also caches a parsed, reified form of the value.
//
// (In practice, both of these are just generic types.  In recommended usage,
// we suggest TPrimitive should be a primitive,
// and TStructured should be used for typed views of that data.)
//
// Control is constructed with only the validation functions;
// one of the update methods must subsequently be called at least one.
//
// Update methods may be used repeatedly to change the held value.
// The validity and the reified value is updated on any update.
//
// Control stores everything it can: that includes the originally given primitive form of the data,
// AND the reified form, AND any errors during validation.
// Control happily stores invalid data; check the error fields before using the data.
// (Validation functions are free to return both a reified object *and* an error,
// in case the partially parsed data is considered useful even though invalid.)
//
// The validation functions may transform data.  In addition to returning a reified value,
// they can also return a "simplified" version of the primitive data data;
// if a validation result contains such data, it will be stored instead of the originally provided primitive value.
// (You can imagine using this to trim extraneous leading and trailing whitespace, for example.)
//
// Control supports multiple styles of usage.
// Use the tryUpdate function if you want an error returned immediately.
// Use the update function if you prefer call chaining style.
//
// An isValid property can be read for convenience.
// The update method will also return an error if the validation failed.
//
// A name property can be provided at construction time if using Control as part of validating a larger object.
// If using this feature, the value of name should match the property name on the larger object,
// so that it can be used for metaprogramming.
// It will also be used as part of error messages when using error aggregation helper functions.
//
// The mutable and descriptive approach taking by this type does come with several drawbacks.
// There are a variety of states where it can contain unlawful data;
// we try to minimize those, but some can only be documented:
//
//  - When first constructed, the data is uninitalized, and thus contains several undefineds,
//     regardless of whether 'undefined' is a valid member of TPrimitive or TStructured.
//     In this scenario, we have accesses to those values throw an error, rather than proceed.
//  - When using the `updateFromUnknown` feature, it's possible to get data that doesn't satisfy
//    TPrimitive.  In this case, we also set accessor methods to throw errors, rather than proceed.
//  - When a validation func returns Error, it has the option to also still return a TStructured value;
//     if it does so, we store it and make it accessible; if it doesn't, accesses to that value with throw errors.
//
// Overall, while Control does intentially store data without regard to the concept of "validity",
// Control does makes a considerable effort not to expose your program to unlawful data that doesn't confirm to Typescript's type hints.
export class Control<TPrimitive, TStructured = TPrimitive> {
	constructor(
		name: string,
		validateFn: ValidationFn<TPrimitive, TStructured>,
		unknownHandlerFn?: FromUnknownFn<TPrimitive>,
	) {
		this.name = name
		this.validateFn = validateFn
		this.unknownHandlerFn = unknownHandlerFn
	}

	// Configuration:
	readonly name: string; // Used to set fields in parent, if fully wired.
	validateFn: (x: TPrimitive) => ValidationResult<TPrimitive, TStructured>;
	unknownHandlerFn?: (x: unknown) => TPrimitive | Error;

	// State:
	// (There's a considerable number of bools here because TPrimitive can include 'undefined' and 'null'!)
	private _isInitialized: boolean; // False if the value was never assigned at all.  If false, all reads panic.
	private _isPrimitive: boolean; // True if the 'given' value matched `TPrimitive`.  If false, most reads panic.
	private _isValid: boolean; // Whether the primitive and parsed values are valid.  They may exist and be non-valid!  All reads continue even when this is false.
	private _isStructured: boolean; // Whether the parsed value exists at all.  If false, attempting to read it will panic.
	private _valueGiven: unknown; // Original completely raw value.  May be same as _valuePrimitive, but also will be set if `updateFromUnknown` was used and failed.
	private _valuePrimitive: TPrimitive;
	private _valueStructured: TStructured;
	private _error: Error | undefined;

	// Internal:
	private mustExist(): never | void {
		if (!this._isInitialized) {
			throw new Error(`access of Control data "${this.name}" that was never initialized`);
		}
	}
	private mustPrimitive(): never | void {
		this.mustExist();
		if (!this._isPrimitive) {
			throw new Error(`access of Control data "${this.name}" was not initialized with data of valid type`);
		}
	}
	private mustStructured(): never | void {
		this.mustExist();
		if (!this._isStructured) {
			throw new Error(`access of Control data "${this.name}" with no structured data assigned`);
		}
	}

	// Getters:
	get valueRaw(): unknown {
		this.mustExist();
		return this._valueGiven;
	}
	get valuePrimitive(): TPrimitive {
		this.mustPrimitive();
		return this._valuePrimitive;
	}
	get isValid(): boolean {
		this.mustPrimitive();
		return this._isValid;
	}
	get valueStructured(): TStructured {
		this.mustStructured();
		return this._valueStructured;
	}
	get error(): Error | undefined {
		this.mustExist();
		return this._error;
	}
	foldErrors(acc: Error[]): Error[] {
		this.mustExist();
		if (this._error) {
			acc.push(new Error(`${this.name}: ${this._error}`))
		}
		return acc
	}

	// Mutators:
	update(x: TPrimitive): this {
		this.tryUpdate(x)
		return this
	}
	tryUpdate(x: TPrimitive): Error | undefined {
		let r = this.validateFn(x)
		this._valueGiven = x;
		this._isInitialized = true;
		this._isPrimitive = true; // Assume our 'x' was lawful!
		if ("simplified" in r) {
			this._valuePrimitive = r.simplified!
		} else {
			this._valuePrimitive = x
		}
		if ("structured" in r) {
			this._isStructured = true
			this._valueStructured = r.structured
		} else {
			this._isStructured = false
			this._valueStructured = undefined as unknown as TStructured // Unlawful, but better than stale data, and accessors guard it.
		}
		if ("error" in r) {
			this._isValid = false
			this._error = r.error
		} else {
			this._isValid = true
			this._error = undefined
		}
		return r.error
	}

	// updateFromUnknown updates accepts a total unknown input value,
	// using an extra transform function to get from 'unknown' to your TPrimitive type,
	// and then applying the validation func to check validity and get a TStructured value.
	//
	// updateFromUnknown also supports an optional argument for plucking a field out of an object
	// rather than requiring the value be given directly.
	// This helps when handling a value that's truly unknown (because typescript doesn't
	// even allow indexing into unknown values without type errors).
	// `updateFromUnknown(val, "field")` is much like `updateFromUnknown(val.field)`, except
	// updateFrom also performs all the typechecking that "field" is a field, "val" is an object and isn't null, etc,
	// and in doing this, is covering all the checks you probably forgot, and also satisfying the typescript compiler.
	updateFromUnknown(value: unknown, fieldName?: string): this {
		this.tryUpdateFromUnknown(value, fieldName)
		return this
	}
	tryUpdateFromUnknown(value: unknown, fieldName?: string): Error | undefined {
		if (!this.unknownHandlerFn) {
			throw new Error("cannot use unknown value processing unless an unknownHandlerFn was given during Control construction!")
		}
		if (fieldName) {
			value = hasProp(value, fieldName) ? value[fieldName] : undefined;
		}
		let primOrError = this.unknownHandlerFn(value)
		if (primOrError instanceof Error) {
			// Pave basically everything.
			this._isInitialized = true;
			this._isPrimitive = false;
			this._isValid = false;
			this._isStructured = false;
			this._valueGiven = value;
			this._valuePrimitive = undefined as unknown as TPrimitive; // Unlawful, but better than stale data, and accessors guard it.
			this._valueStructured = undefined as unknown as TStructured;  // Unlawful, but better than stale data, and accessors guard it.
			this._error = primOrError;
			return primOrError;
		} else {
			return this.tryUpdate(primOrError)
		}
	}
}

export class ControlOptional<TPrimitive, TStructured = undefined> extends Control<TPrimitive | undefined, TStructured | undefined> {
	constructor(
		name: string,
		validateFn: ValidationFn<TPrimitive, TStructured>,
		unknownHandlerFn?: FromUnknownFn<TPrimitive>
	) {
		if (unknownHandlerFn) {
			super(name, validationOptional(validateFn), unknownAllowingUndefined(unknownHandlerFn))
		} else {
			super(name, validationOptional(validateFn))
		}
	}
}

// Extremely high-wizardry incantation to communicate with typescript about indexable properties being present on unknown values.
//
// Merely asking `if (key in obj)` does not give you the ability to `obj[key]`.
// This does.
//
// (Unfortunately, it also seems to permit you to index _any_ key.
// I have no recommendtation for how to deal with this, other than
// to use this function only in a relatively tightly confined area.)
function hasProp<K extends PropertyKey>(obj: unknown, key: K | null | undefined): obj is Record<K, unknown> {
	return key != null && obj != null && typeof obj === 'object' && key in obj;
}

/*=============================================================================================
	Essential types and function types for validation and coercers.
*/

export type ValidationResult<TPrimitive, TStructured = TPrimitive> =
	{ error: Error } |
	{ structured: TStructured, error?: Error, simplified?: TPrimitive };

export type ValidationFn<TPrimitive, TStructured> = (x: TPrimitive) => ValidationResult<TPrimitive, TStructured>

export type FromUnknownFn<TPrimitive> = (x: unknown) => TPrimitive | Error



/*=============================================================================================
	Some frequently-used validation functions and helpers for assembling them.

	Validation functions are named starting with "validate".
	Unknown handler functions are named starting with "unknownTo".
*/

// You probably don't need to use this yourself -- it will be applied automatically to any unknownHandlerFn given to a ControlOptional constructor.
export function validationOptional<TPrimitive, TStructured>(fn: ValidationFn<TPrimitive, TStructured>): ValidationFn<TPrimitive | undefined, TStructured | undefined> {
	return function (x: TPrimitive | undefined): ValidationResult<TPrimitive | undefined, TStructured | undefined> {
		if (x === undefined) {
			return { structured: undefined, simplified: undefined }
		}
		if (typeof x == "string" && x === "") {
			return { structured: undefined, simplified: undefined }
		}
		return fn(x)
	}
}

export function validateString(x: string): ValidationResult<string, string> {
	return { structured: x }
}

export function validateListOfNonemptyString(x: string[]): ValidationResult<string[], string[]> {
	let onlyNonempties = x.filter((s) => s.length > 1)
	return { structured: onlyNonempties, simplified: onlyNonempties }
}

// You probably don't need to use this yourself -- it will be applied automatically to any unknownHandlerFn given to a ControlOptional constructor.
// You might want it if doing advanced constructions like allowing undefined in TPrimitive but not in TStructured, though.
export function unknownAllowingUndefined<TPrimitive>(fn: FromUnknownFn<TPrimitive>): FromUnknownFn<TPrimitive | undefined> {
	return function (x: unknown): TPrimitive | undefined | Error {
		if (x === undefined) {
			return undefined
		}
		return fn(x)
	}
}

export function unknownToString(x: unknown): string | Error {
	if (typeof x === "string") {
		return x
	}
	return new Error(`expected a string`)

}

export function unknownToStringCoercive(x: unknown): string {
	if (typeof x === "string") {
		return x
	}
	if (x === null || x === undefined) {
		return ""
	}
	return x + ""
}

export function unknownToStringListCoercive(x: unknown): string[] {
	if (Array.isArray(x))
		return x.map((v) => unknownToStringCoercive(v))

	if (typeof x == "string")
		return [x]

	if (x === undefined || x === null)
		return []

	return [unknownToStringCoercive(x)]
}
