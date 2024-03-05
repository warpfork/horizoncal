
import {
	CachedMetadata,
	Component,
	TAbstractFile,
	TFile
} from 'obsidian';

import {
	CalendarApi,
	EventDropArg,
	EventInput,
	EventSourceFunc,
	EventSourceFuncArg,
} from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';
import { toLuxonDateTime } from '@fullcalendar/luxon3';

import HorizonCalPlugin from 'src/main';
import { HCEvent, HCEventFilePath } from '../data/data';
import { loadRange } from '../data/loading';

export function makeEventSourceFunc(plugin: HorizonCalPlugin, cal: CalendarApi): EventSourceFunc {
	return (info: EventSourceFuncArg): Promise<EventInput[]> => {
		let hcEvts = loadRange(
			plugin,
			toLuxonDateTime(info.start, cal),
			toLuxonDateTime(info.end, cal)
		);
		let fcEvts = hcEvts.map((hcEvt): EventInput => hcEvt.toFCdata(plugin.settings))
		return Promise.resolve(fcEvts)
	}
}

export function registerVaultChangesToCalendarUpdates(plugin: HorizonCalPlugin, componentLifetime: Component, cal: CalendarApi) {
	// So about events.
	// There are many different places you can hook.  Some more useful (and efficient) than others.
	// For all of these, _we only do it for the lifetime of the view_.
	// If you don't have the calendar view open, there's no need for us to be updating anything.
	// (TODO: there may be one exception to this; we might want the "keep filename in sync" rule to be in effect at all times.
	//
	// We use:
	//  - `metadataCache.on("changed", ...)` -- it covers most of the bases, and gloriously, provides the already parsed frontmatter.
	//  - `vault.on("rename", ...)` -- specifically because the metadata cache change event doesn't cover renames.
	//  - `metadataCache.on("deleted", ...)` -- also not covered by the metadata cache change event.
	//
	// We _don't_ use:
	//  - `vault.on("create", ...)` -- it's covered by `metadataCache.on("changed", ...)`
	//  - `vault.on("modify", ...)` -- it's covered by `metadataCache.on("changed", ...)`
	//  - `vault.on("delete", ...)` -- it's covered by `metadataCache.on("deleted", ...)`, which is similar but mildly more informative (maybe).
	//  - `metadataCache.on("dataview:metadata-change", ...)` -- it sure works, but we're trying to avoid direct dependency on Dataview.
	//
	// Note for changes and renames alike, the handlers can be considerably redundant if the change came *from* the UI.
	// But that's rather hard for us to tell, and idempotency means it makes little difference, so!
	componentLifetime.registerEvent(plugin.app.vault.on(
		"rename",
		(file: TAbstractFile, oldPath: string) => {
			console.log("rename event!")
			let fcEvt = cal.getEventById(oldPath);
			if (fcEvt != null) {
				fcEvt.setProp("id", file.path)
			}
		}
	));
	componentLifetime.registerEvent(plugin.app.metadataCache.on(
		"changed",
		(file: TFile, data: string, cache: CachedMetadata) => {
			console.log("metadata change!", file, cache);

			// If frontmatter isn't present, it more or less means "new file".
			// We also get another event when the frontmatter has been loaded into the cache,
			// so... we can just return early and ignore events without that data present.
			if (!cache.frontmatter) {
				return
			}

			// For events already in the calendar: we update them.
			// If not: we add it one.
			// (TODO: should filter for the relevance of date.)
			let hcEvt = HCEvent.fromFrontmatter(cache.frontmatter);
			hcEvt.loadedFrom = file.path;
			let fcEvt = cal.getEventById(file.path);
			if (fcEvt == null) {
				// New event!
				cal.addEvent(hcEvt.toFCdata(plugin.settings))
				// FIXME it gets a different default background because not event source; silly.
				//  It seems we can give an EventSourceImpl handle as another param; worth?  Hm.  Probably.
			} else {
				// Updating takes a little different road.
				// Most things can be resynced through 'setProp';
				// the start and end dates require specific methods, due to reasons.
				//
				// Could we just nuke and replace the event?
				// Maybe, but in some cases that might fuck with the UI;
				// for example, on mobile, you have to hold-select something to make it adjustable.
				let newData: EventInput = hcEvt.toFCdata(plugin.settings);
				for (let prop in newData) {
					if (prop == "id") continue; // Already sure of that thanks.
					if (prop == "start") { fcEvt.setStart(newData[prop]!); continue }
					if (prop == "end") { fcEvt.setEnd(newData[prop]!); continue }
					fcEvt.setProp(prop, newData[prop])
				}
			}

			// TODO you may also want to hook a rename consideration on this.
			// If the action is a user edit to the frontmatter... yeah, it's possible the file path should get resynced to it.
		}
	));
	componentLifetime.registerEvent(plugin.app.metadataCache.on(
		"deleted",
		(file: TFile, prevCache: CachedMetadata | null) => {
			console.log("delete event!")
			// How very fortunate that file paths alone are event IDs.
			// The 'prevCache' value is best-effort, so if we needed it, we'd be in trouble.
			let fcEvt = cal.getEventById(file.path);
			if (fcEvt != null) {
				fcEvt.remove()
			}
		}
	));
}

type CalendarChangeHook = (info: EventDropArg | EventResizeDoneArg) => {};

export function makeCalendarChangeToVaultUpdateFunc(plugin: HorizonCalPlugin): CalendarChangeHook {
	// This change hook function is used for both fullcal's `eventDrop` and `eventResize` callbacks.
	// They're very similar, except the resize callback gets two different delta values in its info param.
	// They both have old and new events, though, and those both have start and end times,
	// and since we based all our logic on that rather than deltas, we get to reuse the function completely for both.
	//
	// Pleasingly, we also don't need the calendar as an argument to construct this one,
	// because these events actually contain a 'view' field which lets us get a handle to the calendar.
	return async (info: EventDropArg | EventResizeDoneArg) => {
		// Step one: figure out what file we want to update for this.
		// Or, balk immediately if we can't figure it out somehow.
		if (!info.event.id) {
			alert("cannot alter that event; no known data source");
			info.revert()
			return
		}
		let file = plugin.app.vault.getAbstractFileByPath(info.event.id)
		if (!file || !(file instanceof TFile)) {
			alert("event id did not map to a file path!");
			info.revert()
			return
		}

		// Step two: we'll use the fileManager to do an update of the frontmatter.
		// (This handles a lot of serialization shenanigans for us very conveniently.)
		let hcEvt: HCEvent;
		await plugin.app.fileManager.processFrontMatter(file, (fileFm: any): void => {
			// Parse the existing frontmatter, as a precursor to being ready to save it with modifications.
			// And also because we need the timezone info.
			// (Some of this work may be mildly excessive, but it achieves a lot of annealing of data towards convention.)
			hcEvt = HCEvent.fromFrontmatter(fileFm)

			// TODO some validity checks are appropriate here.
			// f.eks. if timezone strings aren't valid, this is gonna go south from here.

			// Shift the dates we got from fullcalendar back into the timezones this event specified.
			//  Fullcalendar doesn't retain timezones -- it flattens everything to an offset only (because javascript Date forces that),
			//   and it also shifts everything to the calendar-wide tz offset.  This is quite far from what we want.
			let newStartDt = toLuxonDateTime(info.event.start as Date, info.view.calendar).setZone(hcEvt.evtTZ.valueStructured)
			let newEndDt = toLuxonDateTime(info.event.end as Date, info.view.calendar).setZone(hcEvt.endTZ.valueStructured || hcEvt.evtTZ.valueStructured)

			// Stir our updated dates into the data.
			// This roundtrips things through strings, which... may seem unnecessary?
			// But on the other hand, that's what we really store, and being literal is good.
			// (Also, I was too lazy to introudce a "setParsed" system to Control; it would require an alternative simplify func, and how we're building the whole magma burrito family; no.)
			hcEvt.evtDate.update(newStartDt.toFormat("yyyy-MM-dd"))
			hcEvt.evtTime.update(newStartDt.toFormat("HH:mm"))
			hcEvt.endDate.update(newEndDt.toFormat("yyyy-MM-dd"))
			hcEvt.endTime.update(newEndDt.toFormat("HH:mm"))

			// Now foist the event structure back into frontmatter form... mutating the object we started with.
			hcEvt.foistFrontmatter(fileFm);

			// Persistence?
			// It's handled magically by processFrontMatter as soon as this callback returns:
			//  it persists our mutations to the `fileFm` argument.
		});

		// Step three: decide if the filename is still applicable or needs to change -- and possibly change it!
		// If we change the filename, we'll also change the event ID.
		let path = HCEventFilePath.fromEvent(hcEvt!);
		let wholePath = path.wholePath;
		if (wholePath != info.event.id) {
			console.log("moving to", wholePath)
			try {
				// Wrapped in a `try` because it throws on "already exists".
				// TODO bother to react better to other errors.
				await plugin.app.vault.createFolder(`${plugin.settings.prefixPath}/${path.dirs}`)
			} catch { }
			// FIXME: filename collision handling needs a better definition.
			//  Right now, we _already updated_ the frontmatter in the file (and that's a different filesystem atomicity phase),
			//  so we can end up with the filename not being in sync.
			//  This is surprisingly non-catestrophic (as in, doesn't instantly destroy user data or break the UI),
			//    as long as we still keep editing the original path...
			//  But it's still not _good_, because it means when reopening the calendar,
			//    the event might not get loaded if its old path was for a day that's not in view.
			try {
				await plugin.app.fileManager.renameFile(file, `${plugin.settings.prefixPath}/${wholePath}`)
			} catch (error) {
				alert("Error: could not move event file -- " + error
					+ "\n\nThis may not cause immediate problems but may cause the event to not be loaded by functions using time windows.");
				return
			}
			info.event.setProp("id", `${plugin.settings.prefixPath}/${wholePath}`) // FIXME canonicalization check, double slash would be bad here.
		}

		// Note that either (or indeed, both) of the above two filesystem updates
		// may cause change detection hooks to... propagate the updated values back to FullCalendar again!
		// _This turns out to be fine_, because it's effectively idempotent.
	}
}
