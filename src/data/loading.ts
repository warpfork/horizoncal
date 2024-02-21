import {
	TFile
} from 'obsidian';

import { getAPI, Literal } from 'obsidian-dataview';


import { DateTime } from 'luxon';
import { HCEvent } from "./data";

// Load events for the given time range.
//
// TODO: currently, ignores the range parameters.
// FUTURE: Loading is based on filesystem paths matching the dates.
// This has a couple of implications and edge-cases to be aware of:
//  - event files stored under inaccurate paths may be missed.
//  - the date used in determining file path is the event's (starting) timezone --
//     that may be a different TZ than the calendar you're about to render,
//      which means you should almost always add a day to either side of your loading range.
//  - this doesn't take any special account of multi-day events --
//     so, to include the possibilty of those, you may want to stretch the 'pre' range *considerably* wide indeed.
//
// This function returns no errors because it will instead log any data validation and parsing errors back to the
// file that contained the strange data, as a property in its frontmatter.
// Events with such errors are not included in the result.
export function loadRange(hcPrefixPath: string, start: DateTime, end: DateTime, pre = 1, post = 1): HCEvent[] {
	// start = start.minus({days: pre})
	// end = end.plus({days: post})

	// Still using dataview as loader.
	type DVT_Record = Record<string, Literal> & { file: TFile };
	const dv = getAPI();
	const pages = dv.pages(`"${hcPrefixPath}"`)
		.where((p: DVT_Record) => String(p.file.name).startsWith("evt-"))

	let results: HCEvent[] = []
	for (let i in pages.array()) {
		// We're gonna read the frontmatter because it's least wild.
		let evtFmRaw = pages[i].file.frontmatter

		// Quick check first.
		if (!evtFmRaw["evtDate"]) {
			// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
			continue
		}

		// Use HCEvent to do a parse.
		// An HCEvent is something you can produce unconditionally:
		// it just might contain data that's flagged as not valid.
		let hcEvt = HCEvent.fromFrontmatter(evtFmRaw);
		hcEvt.loadedFrom = pages[i].file.path;
		let hcEvtErr = hcEvt.validate();
		if (hcEvtErr) {
			// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
			console.log("conversion error:", hcEvtErr);
			continue
		}

		// Accumulate!
		results.push(hcEvt)
	}
	return results
}
