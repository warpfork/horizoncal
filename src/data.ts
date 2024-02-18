
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
		v.evtTZ = new Control("evtTZ", validateTZ).update(fm.evtTZ);
		v.endDate = new ControlOptional("endDate", validateDate).update(fm.endDate);
		v.endTime = new ControlOptional("endTime", validateTime).update(fm.endTime);
		v.endTZ = new ControlOptional("endTZ", validateTZ).update(fm.endTZ);
		v.completed = fm.completed || false;
		v.cancelled = fm.cancelled || false;
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
	evtTZ: Control<string>; // Named timezome.
	endDate: ControlOptional<string, DateTime>;
	endTime: ControlOptional<string, Duration>;
	endTZ: ControlOptional<string>;
	completed?: boolean;
	cancelled?: boolean;

	allControls(): Control<any, any>[] {
		return [
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
		return this.evtDate.valueParsed.plus(this.evtTime.valueParsed!).setZone(this.evtTZ.valueRaw, {keepLocalTime: true})
	}

	// Returns a complete DateTime with the date, the time, and the timezone assembled.
	// This function handles defaulting to the start day and start timezone.
	getCompleteEndDt(): DateTime {
		let v = this.evtDate.valueParsed;
		v = (this.endDate.valueParsed) ? this.endDate.valueParsed : v;
		v = v.plus(this.endTime.valueParsed!);
		v = (this.endTZ.valueRaw) ? v.setZone(this.endTZ.valueRaw, {keepLocalTime: true}) : v.setZone(this.evtTZ.valueRaw, {keepLocalTime: true});
		return v;
	}
}

function validateDate(ymd: string): ValidateResult<string, DateTime> {
	const fmt = "yyyy-MM-dd"
	ymd+=""; // Violently coerce to string.
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
function validateTZ(namedZone: string): ValidateResult<string> {
	if (IANAZone.isValidZone(namedZone)) {
		return { parsed: undefined }
	}
	return { error: new Error(`"${namedZone}" is not a known time zone identifier`) }
}

/*-----------------------------------------*/
/* And now for somewhat more cursed stuff. */

function parseYMD(ymd: string): DateTime | { error: Error } {
	let parsed = DateTime.fromFormat(ymd, "yyyy-MM-dd");
	if (parsed.invalidReason) {
		return { error: Error(parsed.invalidReason + ": " + parsed.invalidExplanation as string) }
	}
	//return {year: parsed.year, month: parsed.month, day: parsed.day}
	return parsed
}

// Parse a string containing hours and minutes (and maybe even seconds)
// into a Luxon Duration with hours and minutes.
function parseTime(time: string): Duration {
	let parsed = DateTime.fromFormat(time, "h:mm a");
	if (parsed.invalidReason) {
		parsed = DateTime.fromFormat(time, "HH:mm");
	}
	if (parsed.invalidReason) {
		parsed = DateTime.fromFormat(time, "HH:mm:ss");
	}
	if (parsed.invalidReason) {
		// If you manage to be completely inscrutable, I'm rounding you to 15 minutes.  Zero is worse.
		return Duration.fromObject({ hours: 0, minutes: 15 });
	}
	return Duration.fromObject({ hours: parsed.hour, minutes: parsed.minute });
};

function slugify(str: string): string {
	return String(str)
		.normalize('NFKD') // split accented characters into their base characters and diacritical marks
		.replace(/[\u0300-\u036f]/g, '') // remove all the accents, which happen to be all in the \u03xx UNICODE block.
		.trim() // trim leading or trailing whitespace
		.replace(/[^a-zA-Z0-9 -]/g, '') // remove non-alphanumeric characters
		.replace(/\s+/g, '-') // replace spaces with hyphens
		.replace(/-+/g, '-'); // remove consecutive hyphens
}

/*-------------------------------------------------------------*/
/* File paths show up enough that they're worth a helper type. */

export class HCEventFilePath {
	static fromFrontmatter(evtFm: any): HCEventFilePath {
		let dt = parseYMD(evtFm.evtDate);
		if ("error" in dt) {
			dt = DateTime.local(0, 0, 0, 0, 0, 0)
		}
		return new HCEventFilePath({
			dirs: dt.toFormat("yyyy/MM/dd"),
			fprefix: "evt-" + dt.toFormat("yyyy-MM-dd"),
			slug: slugify(evtFm.title),
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
