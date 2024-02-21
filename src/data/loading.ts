import {
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
} from 'obsidian';

import { DateTime, Interval } from 'luxon';
import HorizonCalPlugin from 'src/main';
import { HCEvent } from "./data";

// Load events for the given time range.
//
// Loading is based on filesystem paths matching the dates.
// This has a couple of implications and edge-cases to be aware of:
//  - event files stored under inaccurate paths may be missed.
//  - the date used in determining file path is the event's (starting) timezone --
//     that may be a different TZ than the calendar you're about to render,
//      which means you should almost always add a day to either side of your loading range.
//  - this doesn't take any special account of multi-day events --
//     so, to include the possibilty of those, you may want to stretch the 'pre' range *considerably* wide indeed.
//
// A reference to the complete HorizonCalPlugin is taken because it provides access to the app and vault references,
// and also beacuse we need the prefix path settings values.
//
// This function returns no errors because it will instead log any data validation and parsing errors back to the
// file that contained the strange data, as a property in its frontmatter.
// Events with such errors are not included in the result.
export function loadRange(plugin: HorizonCalPlugin, start: DateTime, end: DateTime, pre = 1, post = 1): HCEvent[] {
	start = start.minus({days: pre})
	end = end.plus({days: post})

	// Get all the filenames that are of interest.
	// Perhaps surprisingly, this is... not particularly recursive.
	// The easiest way to go about it is to just ask about the existence of a folder per date;
	// only within that to we "recurse" (wherein we expect a depth of... one).
	let range = Interval.fromDateTimes(start, end)
	let files: TFile[] = []
	range.splitBy({days: 1}).forEach((value) => {
		let dateDir = plugin.app.vault.getAbstractFileByPath(`${plugin.settings.prefixPath}/${value.start!.toFormat("yyyy/MM/dd")}`)
		// At this point we'll have null if there's no dir for that date,
		// or indeed if the entire horizoncal dir doesn't exist.
		// That's... fine.  Then you have no data, eh?
		// console.log("attempting load for", value.start!.toFormat("yyyy/MM/dd"), "got", dateDir)
		if (!(dateDir instanceof TFolder)) return
		Vault.recurseChildren(dateDir, (child: TAbstractFile) => {
			// Note that this *does* recurse, we just *expect* it to be depth one.
			// It's harmless if goes deeper, though.
			// The directory itself that's the root of the query also gets yielded, and we just ignore that as well.
			if (!(child instanceof TFile)) return
			if (child.name.startsWith("evt-") && child.name.endsWith(".md")) {
				files.push(child)
			}
		})
	})
	//console.log(`got ${files.length} files for interval ${range.toFormat("yyyy/MM/dd")}:`, files)

	// For each relevant file, get the frontmatter from the metadata cache,
	// and if it's at all parsable, accumulate the parsed HCEvent.
	let results: HCEvent[] = []
	files.forEach((file: TFile) => {
		let metadata = plugin.app.metadataCache.getFileCache(file);
		let evtFmRaw = metadata!.frontmatter!

		// Quick check first.
		if (!evtFmRaw["evtDate"]) {
			// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
			return
		}

		// Use HCEvent to do a parse.
		// An HCEvent is something you can produce unconditionally:
		// it just might contain data that's flagged as not valid.
		let hcEvt = HCEvent.fromFrontmatter(evtFmRaw);
		hcEvt.loadedFrom = file.path;
		let hcEvtErr = hcEvt.validate();
		if (hcEvtErr) {
			// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
			console.log("conversion error:", hcEvtErr);
			return
		}

		// Accumulate!
		results.push(hcEvt)
	})
	return results
}
