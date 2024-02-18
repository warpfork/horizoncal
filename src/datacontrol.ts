
// Control handles a value and its validation.
// It stores the raw form, the parsed form, and
// remembers if the value is considered valid and any details of errors from validation.
// In general, it retains _all_ information;
// the user still ahs to check if that information is valid before using it.
//
// When a value is supplied, the raw value is always stored.
// The validation function is applied,
// and if it returns any value at all for the parsed value, that is also stored.
// Any error from the validation function is also stored,
// and causes the isValid boolean to be set to false.
// (Validation functions are free to return both a parsed object *and* an error,
// in case the partially parsed data is considered useful even though invalid.)
// The validation function can also return a "simplified" version of the raw data;
// if present, this will be stored instead of the originally provided raw value.
//
// Use the tryUpdate function if you want an error returned immediately.
// Use the update function if you prefer call chaining style.
//
// An isValid property can be read for convenience.
// The update method will also return an error if the validation failed.
//
// A name property can be set if using Control as part of validating a larger object.
// If using this feature, the value of name should match the property name on the larger object,
// so that it can be used for metaprogramming.
// It will also be used as part of error messages when using error aggregation helper functions.
export class Control<TRaw, TParsed = undefined> {
	constructor(name: string, validateFn: ValidationFn<TRaw, TParsed>) {
		this.name = name
		this.validateFn = validateFn
	}

	// Configuration:
	readonly name: string; // Used to set fields in parent, if fully wired.
	validateFn: (x: TRaw) => ValidateResult<TRaw, TParsed>;

	// State:
	private _valueRaw: TRaw;
	private _isValid: boolean;
	private _valueParsed: TParsed;
	private _error: Error | undefined;

	// Getters:
	get valueRaw(): TRaw { return this._valueRaw; }
	get isValid(): boolean { return this._isValid; }
	get valueParsed(): TParsed { return this._valueParsed; }
	get error(): Error | undefined { return this._error; }
	foldErrors(acc: Error[]): Error[] {
		if (!this._isValid) {
			acc.push(new Error(`${this.name}: ${this._error}`))
		}
		return acc
	}

	// Mutators:
	update(x: TRaw): this {
		this.tryUpdate(x)
		return this
	}
	tryUpdate(x: TRaw): Error | undefined {
		let r = this.validateFn(x)
		if ("simplified" in r && r.simplified !== undefined) {
			this._valueRaw = r.simplified
		} else {
			this._valueRaw = x
		}
		if ("parsed" in r) {
			this._valueParsed = r.parsed
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
}

export type ValidateResult<TRaw, TParsed = undefined> =
	{ error: Error } |
	{ parsed: TParsed, error?: Error, simplified?: TRaw };

export type ValidationFn<TRaw, TParsed> = (x: TRaw) => ValidateResult<TRaw, TParsed>

export class ControlOptional<TRaw, TParsed = undefined> extends Control<TRaw | undefined, TParsed | undefined> {
	constructor(name: string, validateFn: ValidationFn<TRaw, TParsed>) {
		super(name, validationOptional(validateFn))
	}
}

export function validationOptional<TRaw, TParsed>(fn: ValidationFn<TRaw, TParsed>): ValidationFn<TRaw | undefined, TParsed | undefined> {
	return function (x: TRaw | undefined): ValidateResult<TRaw | undefined, TParsed | undefined> {
		if (x === undefined) {
			return { parsed: undefined, simplified: undefined }
		}
		return fn(x)
	}
}
