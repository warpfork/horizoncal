

import { DateTime, Duration } from 'luxon';

import { Literal, PageMetadata } from 'obsidian-dataview';

import {
	EventInput,
} from '@fullcalendar/core';

import { HCEvent } from './event';

/*

About dates.

Oh, javascript.

When interacting with fullcalendar, there are two valid options
(if you don't want to introduce extra ambiguity around TZ, which, let's not, hm?):
use a (fairly full, with "Z") ISO8601 string;
or use the native js Date object.

Meanwhile, dataview uses Luxon (and Obsidian itself prefers Moment)...

We use Luxon in most HC code because we're closest to dataview most of the time.

*/

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

export function dvToHCEvent(item: Record<string, Literal> & { file: PageMetadata }): HCEvent | null {
	return {
		event: item['event'],
		title: item['title'],
		date: item['date'],
		// Dear god js has to have a better way to do this.
		// But only required fields had to be mapped explicitly?  Hm.
		// startTime: item['startTime'],
		// endDate: item['endDate'], // Don't copy date here if endDate absent; want to round-trip with still absence.
		// endTime: item['endTime'],
		...item
		// oh my god that copies everything?  typescript isn't real.  this syntax is only sugar, never structure.  Oh man.
	};
}

export function toFCEvent(
	hcEvt: HCEvent
): EventInput | null {
	let event: EventInput = {
		// TODO i'm not sure what to do for IDs.  Dislike of UUIDs.  Not sure if date being here will fuck with shit.  Can ID be updated?
		//  Test if `event.setProp( name, value )` can change ID on the objects after parse.
		id: "asdf",
		title: hcEvt.title,
		// allDay: hcEvt.allDay,
		startTime: hcEvt.date,
		endTime: hcEvt.endDate || hcEvt.date,
	};
	return event;
}
