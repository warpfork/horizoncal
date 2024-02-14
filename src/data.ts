
import { z } from "zod";

import { DateTime, Duration } from 'luxon';

// FIXME: these 'transform' calls a bit cursed because they fail when you return error.
// I really don't know how to hold Zod well yet.
//
// ... it's fine matching the object rules on luxon's types, which is interesting.
// it also removes the additional code and data, which I guess makes sense.

const YMDSchema = z.string().transform(parseYMD).pipe(z.object({
	year: z.number().int().gte(1000).lte(9999),
	month: z.number().int().gte(1).lte(12),
	day: z.number().int().gte(1).lte(31), // forgive me.
})).brand("YMD")

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
	eventType: z.string(), // An enum, of sorts, but a user-defined one, so no real validation.
	title: z.string().default(""),
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

function parseYMD(ymd: string): { year: number, month: number, day: number } | Error {
	let parsed = DateTime.fromFormat(ymd, "yyyy-MM-dd");
	if (parsed.invalidReason) {
		return Error(parsed.invalidReason)
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
