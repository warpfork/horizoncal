
import { z } from "zod";

import { Control, ValidateResult } from "./datacontrol";

import { DateTime, Duration, IANAZone } from 'luxon';

// HCEvent is a holder for event properties.
//
// HCEvent just holds data; it is not necessarily data in a valid state.
// Using HCEvent generally works by dropping frontmatter into it, as strings.
// Then, you can ask for a validation check.
export class HCEvent {
	static fromFrontmatter(fm: any): HCEvent {
		let v = new HCEvent();
		v.title = fm.title;
		v.evtType = fm.evtType;
		v.evtDate = new Control("evtDate", validateDate).update(fm.evtDate);
		v.evtTime = new Control("evtTime", validateTime).update(fm.evtTime);
		v.evtTZ = new Control("evtTZ", validateTZ).update(fm.evtTZ);
		v.endDate = new Control("endDate", validateDate).update(fm.endDate);
		v.endTime = new Control("endTime", validateTime).update(fm.endTime);
		v.endTZ = new Control("endTZ", validateTZ).update(fm.endTZ);
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

	title: string;
	evtType: string;
	evtDate: Control<string, DateTime>; // Only contains YMD components.
	evtTime: Control<string, Duration>; // Only contains HHmm components.
	evtTZ: Control<string>; // Named timezome.
	endDate: Control<string, DateTime | undefined>;
	endTime: Control<string, Duration | undefined>;
	endTZ: Control<string | undefined>;
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
}

function validateDate(ymd: string): ValidateResult<string, DateTime> {
	const fmt = "yyyy-MM-dd"
	// You can give an already parsed DT to us if you want,
	// but imma roundtrip it through string anyway just to make sure anything beyond ymd is dropped.
	// if (ymd instanceof DateTime) {
	// 	let str = ymd.toFormat(fmt)
	// 	return {
	// 		parsed: DateTime.fromFormat(str, fmt),
	// 		simplified: str,
	// 	}
	// }
	// NOPE JK, made the type matching harder for no good reason.
	let parsed = DateTime.fromFormat(ymd, fmt);
	if (parsed.invalidReason) {
		return { error: Error(parsed.invalidReason + ": " + parsed.invalidExplanation as string) }
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

// FIXME: these 'transform' calls a bit cursed because they fail when you return error.
// I really don't know how to hold Zod well yet.
//
// ... it's fine matching the object rules on luxon's types, which is interesting.
// it also removes the additional code and data, which I guess makes sense.

const YMDSchema = z.string().transform((val, ctx) => {
	let parsed = parseYMD(val)
	if ("error" in parsed) {
		ctx.addIssue({
			code: z.ZodIssueCode.invalid_date,
			message: parsed.error.message,
		});
		return z.NEVER;
	}
	return parsed;
}).pipe(z.object({  // These are functionally already validate by the transform!  But it still has the effect of allow-listing the values.
	year: z.number().int().gte(1000).lte(9999),
	month: z.number().int().gte(1).lte(12),
	day: z.number().int().gte(1).lte(31),
}))

const HoursMinutesSchema = z.string().transform(parseTime).pipe(z.object({
	hours: z.number().int().gte(0),
	minutes: z.number().int().gte(0).lte(59),
}))

// This is the schema for the frontmatter, as it is serialized...
// but with a LITTLE bit of date parsing, powered by a combo of full date library usage, and then zod reducing it again.
// (I have no idea if this is particularly sane, but I ended up with this code path working for now, so, uh, okay, let's roll.)
// 
// So, optional fields are in use.  Any automatic fill-in of values is later, and generally close to the usage site.
export const HCEventFrontmatterSchema = z.object({
	title: z.string().default(""),
	evtType: z.string(), // An enum, of sorts, but a user-defined one, so no real validation.
	evtDate: YMDSchema,
	evtTime: HoursMinutesSchema.optional(),
	evtTZ: z.string().optional(), // Validating this is a WHOLE thing.  It's also not really optional, but I don't want parse to fail early when it's missing.
	endDate: YMDSchema.optional(),
	endTime: HoursMinutesSchema.optional(),
	endTZ: z.string().optional(),
	completed: z.boolean().optional(),
	cancelled: z.boolean().optional(),
});
export type HCEventFrontmatter = z.infer<typeof HCEventFrontmatterSchema>;


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
