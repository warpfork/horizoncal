
import { App, TAbstractFile, TFile } from "obsidian";

import {
	Control,
	ControlOptional,
	ValidationResult,
	unknownAllowingUndefined,
	unknownToStringCoercive,
	validateString,
} from "./datacontrol";

import { DateTime, Duration, IANAZone } from 'luxon';

// HCEvent is a holder for event properties.
//
// HCEvent just holds data; it is not necessarily data in a valid state.
// Using HCEvent generally works by dropping frontmatter into it, as strings.
// Then, you can ask for a validation check.
export class HCEvent {
	// Parse an HCEvent from a "frontmatter" object.
	// Never returns an error, because all data fields store validation errors;
	// get any accumulated issues by calling `validate` on the returned object.
	// (In the wildest case that 'fm' is null or empty, you'll simply have a validation error on every single field.)
	static fromFrontmatter(fm: unknown): HCEvent {
		// Note that obsidian frontmatter gives you nulls for fields that present but have no apparent value.
		let v = new HCEvent();
		v.title = new Control("title", validateString, unknownToStringCoercive).updateFromUnknown(fm, 'title');
		v.evtType = new Control("evtType", validateString, unknownToStringCoercive).updateFromUnknown(fm, 'evtType');
		v.evtDate = new Control("evtDate", validateDate, unknownToStringCoercive).updateFromUnknown(fm, 'evtDate');
		v.evtTime = new ControlOptional("evtTime", validateTime, unknownToStringCoercive).updateFromUnknown(fm, 'evtTime');
		v.evtTZ = new Control("evtTZ", validateTZ_defaultLocal, unknownAllowingUndefined(unknownToStringCoercive)).updateFromUnknown(fm, 'evtTZ');
		v.endDate = new ControlOptional("endDate", validateDate, unknownToStringCoercive).updateFromUnknown(fm, 'endDate');
		v.endTime = new ControlOptional("endTime", validateTime, unknownToStringCoercive).updateFromUnknown(fm, 'endTime');
		v.endTZ = new ControlOptional("endTZ", validateTZ, unknownToStringCoercive).updateFromUnknown(fm, 'endTZ');
		return v;
	}

	// Load an HCEvent from a file in the vault.
	// This requires the entire app handle (not just a vault handle) because it consults the metadatacache.
	//
	// An error is returned if the path is not a file.
	// Otherwise, errors of parsing and validation are stored and returned (same as with `fromFrontmatter`).
	//
	// The path the data is loaded from will be retained in `loadedFrom` (and will be normalized).
	static fromPath(app: App, path: string): HCEvent | Error {
		return this._fromFile(app, app.vault.getAbstractFileByPath(path));
	}

	// Exactly as per `fromPath`, but saves a little work if you already have a `TFile` in hand.
	static fromFile(app: App, file: TFile | TAbstractFile): HCEvent | Error {
		return this._fromFile(app, file);
	}

	// Ghastly little helper for nullablity type appeasement.
	private static _fromFile(app: App, file: TFile | TAbstractFile | null): HCEvent | Error {
		if (!file || !(file instanceof TFile)) {
			return new Error(`could not load HCEvent data from '${file}' -- not a file`);
		}
		let metadata = app.metadataCache.getFileCache(file);
		let evtFmRaw = metadata!.frontmatter!;
		let hcEvt = this.fromFrontmatter(evtFmRaw);
		hcEvt.loadedFrom = file.path;
		return hcEvt;
	}

	// There are still a few higher level validity rules not covered.
	//
	// For example, endTZ without an endTime is kinda silly.
	// However, that exaple also isn't really worth checking because it's never something that deserves user action;
	// whether we elide that from serialization at the end is a choice local to serializing.
	//
	// The basic types of fields we didn't apply Control wrappers to is also currently unchecked.
	// This could create some funny JS errors, but the UI guides you pretty hard away from it so I just haven't bothered yet.
	// TODO: this is probably gonna need to change immediately, since we started using Control for mutation attachment too.
	//
	// There's also the small matter cross-field checks like "is the end actually after the beginning?".
	// Those aren't handled yet either.
	validate(): Error | undefined {
		let errors: Error[] = [];
		this.allControls().forEach((control) => control.foldErrors(errors))
		if (errors.length == 1) {
			return errors[0]
		}
		if (errors.length > 1) {
			let estrlist = ""
			errors.forEach((err) => estrlist += ` - ${err}\n`)
			return new Error("multiple validation errors:\n" + estrlist)
		}
	}

	title: Control<string, string>;
	evtType: Control<string, string>;
	evtDate: Control<string, DateTime>; // Only contains YMD components.
	evtTime: ControlOptional<string, Duration>; // Only contains HHmm components.
	evtTZ: Control<string | undefined, string>; // Named timezome.
	endDate: ControlOptional<string, DateTime>;
	endTime: ControlOptional<string, Duration>;
	endTZ: ControlOptional<string, string>;

	// Optionally, a record of the path this was loaded from.  (Doesn't mean it's where this *should* be stored!)
	// (It's tempting to store a whole TFile here for convenience, but I think it's better to take a trip through the vault API each time to reduce the range of time you might be holding invalid beliefs about the filesystem state.)
	loadedFrom?: string;

	allControls(): Control<any, any>[] {
		return [
			this.title,
			this.evtType,
			this.evtDate,
			this.evtTime,
			this.evtTZ,
			this.endDate,
			this.endTime,
			this.endTZ,
		]
	}

	// Returns a complete DateTime with the date, the time, and the timezone assembled.
	getCompleteStartDt(): DateTime {
		return this.evtDate.valueStructured.plus(this.evtTime.valueStructured!).setZone(this.evtTZ.valuePrimitive, { keepLocalTime: true })
	}

	// Returns a complete DateTime with the date, the time, and the timezone assembled.
	// This function handles defaulting to the start day and start timezone.
	getCompleteEndDt(): DateTime {
		let v = this.evtDate.valueStructured;
		v = (this.endDate.valueStructured) ? this.endDate.valueStructured : v;
		v = v.plus(this.endTime.valueStructured!);
		v = (this.endTZ.valuePrimitive) ? v.setZone(this.endTZ.valuePrimitive, { keepLocalTime: true }) : v.setZone(this.evtTZ.valuePrimitive, { keepLocalTime: true });
		return v;
	}

	// Mutate (!) the given object to contain our data.
	// Rebuilds the entire object so that the ordering is controlled,
	// but unfamiliar fields will be retained (just moved to the bottom).
	// Any of our own data that's redundant (such as and endDate that's the same as the start) are removed.
	//
	// The same object is also returned for convenience,
	// and the initial object can be elided if you have no data to persist.
	foistFrontmatter(fm: any = {}): any {
		// Kick off with a copy of any fields we don't recognize.
		// To control order, we're going to nuke every property in the given object and put them back in again.
		// We'll keep this object on the side with a copy of the original data,
		// then merge back any remaining properties that aren't ours at the end.
		// This dance creates stable ordering (and shifts user content to the bottom).
		let copy: any = {};
		for (var prop in fm) {
			if (!(prop in this)) {
				copy[prop] = fm[prop];
			}
			delete fm[prop];
		}

		// Storing properties got surprisingly generalized.
		//
		// Two corners are currently rounded off, here:
		//  - Quietly forgetting about those bools we didn't migrate to Control yet.  Not sure if keeping them at all.
		//  - Haven't handled any of the optionality of times for all-day events.
		this.allControls().forEach((control) => {
			// Handle the special cases where the value doesn't get persisted.
			switch (control.name) {
				case "endDate":
					// Skip storing this, even if it exists, if it's the same as the start date.
					if (!this.endDate.valueStructured) {
						return
					}
					if (this.evtDate.valueStructured.year == this.endDate.valueStructured.year
						&& this.evtDate.valueStructured.month == this.endDate.valueStructured.month
						&& this.evtDate.valueStructured.day == this.endDate.valueStructured.day) {
						return
					}
					break;
			}

			// For everyone that got here: yep, be saved.
			if (control.isValid) {
				fm[control.name] = control.valuePrimitive
			}
		})

		// Now copy over any remaining properties in the original.
		// This is part of the dance to control property orders.
		for (var prop in copy) {
			if (!(prop in fm)) {
				fm[prop] = copy[prop]
			}
		}
	}
}

function validateDate(ymd: string): ValidationResult<string, DateTime> {
	const fmt = "yyyy-MM-dd"
	let parsed = DateTime.fromFormat(ymd, fmt);
	if (parsed.invalidReason) {
		return { error: new Error(parsed.invalidReason + ": " + parsed.invalidExplanation as string) }
	}
	return {
		structured: parsed,
		simplified: parsed.toFormat(fmt),
	}
}
function validateTime(hhmm: string): ValidationResult<string, Duration> {
	let parsed = DateTime.fromFormat(hhmm, "HH:mm");
	if (parsed.invalidReason) {
		return { error: Error(parsed.invalidReason + ": " + parsed.invalidExplanation as string) }
	}
	return {
		structured: Duration.fromObject({ hour: parsed.hour, minute: parsed.minute }),
		simplified: parsed.toFormat("HH:mm"),
	}
}
function validateTZ(namedZone: string): ValidationResult<string, string> {
	if (IANAZone.isValidZone(namedZone)) {
		return { structured: namedZone }
	}
	return { error: new Error(`"${namedZone}" is not a known time zone identifier`) }
}
function validateTZ_defaultLocal(namedZone: string | undefined): ValidationResult<string | undefined, string> {
	if (!namedZone) {
		let zn = DateTime.local().zoneName;
		return { structured: zn, simplified: zn }
	}
	return validateTZ(namedZone)
}

/*-------------------------------------------------------------*/
/* File paths show up enough that they're worth a helper type. */

export class HCEventFilePath {
	static fromEvent(hcEvt: HCEvent): HCEventFilePath {
		return new HCEventFilePath({
			dirs: hcEvt.evtDate.valueStructured.toFormat("yyyy/MM/dd"),
			fprefix: "evt-" + hcEvt.evtDate.valuePrimitive,
			slug: slugify(hcEvt.title.valuePrimitive),
		})
	}

	constructor(init?: Partial<HCEventFilePath>) {
		Object.assign(this, init);
	}

	dirs: string;
	fprefix: string;
	slug: string;

	get wholePath(): string {
		return this.dirs + "/" + this.fprefix + "--" + this.slug + ".md"
	}

}

function slugify(str: string): string {
	return String(str)
		.normalize('NFKD') // split accented characters into their base characters and diacritical marks
		.replace(/[\u0300-\u036f]/g, '') // remove all the accents, which happen to be all in the \u03xx UNICODE block.
		.trim() // trim leading or trailing whitespace
		.replace(/[^a-zA-Z0-9 -]/g, '') // remove non-alphanumeric characters
		.replace(/\s+/g, '-') // replace spaces with hyphens
		.replace(/-+/g, '-'); // remove consecutive hyphens
}
