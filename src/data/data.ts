
import { Control, ControlOptional, ValidateResult, validateString } from "./datacontrol";

import { DateTime, Duration, IANAZone } from 'luxon';

// HCEvent is a holder for event properties.
//
// HCEvent just holds data; it is not necessarily data in a valid state.
// Using HCEvent generally works by dropping frontmatter into it, as strings.
// Then, you can ask for a validation check.
export class HCEvent {
	static fromFrontmatter(fm: any): HCEvent {
		let v = new HCEvent();
		v.title = new Control("title", validateString).update(fm.title);
		v.evtType = new Control("evtType", validateString).update(fm.evtType);
		v.evtDate = new Control("evtDate", validateDate).update(fm.evtDate);
		v.evtTime = new ControlOptional("evtTime", validateTime).update(fm.evtTime);
		v.evtTZ = new Control("evtTZ", validateTZ_defaultLocal).update(fm.evtTZ);
		v.endDate = new ControlOptional("endDate", validateDate).update(fm.endDate);
		v.endTime = new ControlOptional("endTime", validateTime).update(fm.endTime);
		v.endTZ = new ControlOptional("endTZ", validateTZ).update(fm.endTZ);
		return v;
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

	loadedFrom?: string; // Optionally, a record of the path this was loaded from.  (Doesn't mean it's where this *should* be stored!)

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
		return this.evtDate.valueParsed.plus(this.evtTime.valueParsed!).setZone(this.evtTZ.valueRaw, { keepLocalTime: true })
	}

	// Returns a complete DateTime with the date, the time, and the timezone assembled.
	// This function handles defaulting to the start day and start timezone.
	getCompleteEndDt(): DateTime {
		let v = this.evtDate.valueParsed;
		v = (this.endDate.valueParsed) ? this.endDate.valueParsed : v;
		v = v.plus(this.endTime.valueParsed!);
		v = (this.endTZ.valueRaw) ? v.setZone(this.endTZ.valueRaw, { keepLocalTime: true }) : v.setZone(this.evtTZ.valueRaw, { keepLocalTime: true });
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
					if (!this.endDate.valueParsed) {
						return
					}
					if (this.evtDate.valueParsed.year == this.endDate.valueParsed.year
						&& this.evtDate.valueParsed.month == this.endDate.valueParsed.month
						&& this.evtDate.valueParsed.day == this.endDate.valueParsed.day) {
						return
					}
					break;
			}

			// For everyone that got here: yep, be saved.
			if (control.isValid) {
				fm[control.name] = control.valueRaw
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

function validateDate(ymd: string): ValidateResult<string, DateTime> {
	const fmt = "yyyy-MM-dd"
	ymd += ""; // Violently coerce to string.
	let parsed = DateTime.fromFormat(ymd, fmt);
	if (parsed.invalidReason) {
		return { error: new Error(parsed.invalidReason + ": " + parsed.invalidExplanation as string) }
	}
	return {
		parsed: parsed,
		simplified: parsed.toFormat(fmt),
	}
}
function validateTime(hhmm: string): ValidateResult<string, Duration> {
	let parsed = DateTime.fromFormat(hhmm, "HH:mm");
	if (parsed.invalidReason) {
		return { error: Error(parsed.invalidReason + ": " + parsed.invalidExplanation as string) }
	}
	return {
		parsed: Duration.fromObject({ hour: parsed.hour, minute: parsed.minute }),
		simplified: parsed.toFormat("HH:mm"),
	}
}
function validateTZ(namedZone: string): ValidateResult<string, string> {
	if (IANAZone.isValidZone(namedZone)) {
		return { parsed: namedZone }
	}
	return { error: new Error(`"${namedZone}" is not a known time zone identifier`) }
}
function validateTZ_defaultLocal(namedZone: string | undefined): ValidateResult<string | undefined, string> {
	if (!namedZone) {
		let zn = DateTime.local().zoneName;
		return { parsed: zn, simplified: zn }
	}
	return validateTZ(namedZone)
}

/*-------------------------------------------------------------*/
/* File paths show up enough that they're worth a helper type. */

export class HCEventFilePath {
	static fromEvent(hcEvt: HCEvent): HCEventFilePath {
		return new HCEventFilePath({
			dirs: hcEvt.evtDate.valueParsed.toFormat("yyyy/MM/dd"),
			fprefix: "evt-" + hcEvt.evtDate.valueRaw,
			slug: slugify(hcEvt.title.valueRaw),
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
