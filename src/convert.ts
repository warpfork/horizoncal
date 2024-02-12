


import { Literal, PageMetadata } from 'obsidian-dataview';

import {
	EventInput,
} from '@fullcalendar/core';

import { HCEvent, HCEventSchema } from './data';

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


export function dvToHCEvent(item: Record<string, Literal> & { file: PageMetadata }): HCEvent | null {
	const result = HCEventSchema.safeParse(item);
	if (!result.success) {
		console.log("conversion error:", result.error);
		return null
	}
	console.log("WOW", result);
	return result.data;
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
