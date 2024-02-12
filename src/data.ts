
import { z } from "zod";

import { DateTime, Duration } from 'luxon';

// hang ON also dataview is parsing the date field intoa DateTime already?!!  GAHHHHHH

const YMDSchema = z.string().transform(parseTime).pipe(z.object({
	year: z.number().int().gte(1000).lte(9999),
	month: z.number().int().gte(1).lte(12),
	day: z.number().int().gte(1).lte(31), // forgive me.
})).brand("YMD") //.transform()  // ... i'm in conversion hell.  it might be safest to declare we're keeping this strings.  only fix at runtime.

const HoursMinutesSchema = z.string().transform(parseTime).pipe(z.object({
	hours: z.number().int().gte(0),
	minutes: z.number().int().gte(0).lte(59),
}))

export const HCEventSchema = z.object({
	event: z.string(), // An enum, of sorts, but a user-defined one, so no real validation.
	title: z.string().default(""),
	date: YMDSchema,
	startTime: HoursMinutesSchema.optional(),
	endDate: YMDSchema.optional(),
	endTime: HoursMinutesSchema.optional(),
	completed: z.boolean().optional(),
	cancelled: z.boolean().optional(),

});
export type HCEvent = z.infer<typeof HCEventSchema>;


/*-----------------------------------------*/
/* And now for somewhat more cursed stuff. */

// Parse a string containing hours and minutes (and maybe even seconds)
// into a Luxon Duration with hours and minutes.
function parseTime(time: string): Duration | null {
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
	return Duration.fromDurationLike(parsed);
};
