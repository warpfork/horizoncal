
import {
	App,
	CachedMetadata,
	Component,
	TAbstractFile,
	TFile,
} from 'obsidian';

import {
	Calendar,
	EventInput,
	EventSourceFunc, EventSourceFuncArg,
} from '@fullcalendar/core';
import { toLuxonDateTime } from '@fullcalendar/luxon3';

import HorizonCalPlugin from 'src/main';
import { HCEvent } from '../data/data';
import { loadRange } from '../data/loading';
import { HorizonCalSettings } from '../settings/settings';

export function makeEventSourceFunc(plugin: HorizonCalPlugin, cal: Calendar): EventSourceFunc {
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

export function registerVaultChangesToCalendarUpdates(pluginSettings: HorizonCalSettings, app: App, componentLifetime: Component, cal: Calendar) {
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
	componentLifetime.registerEvent(app.vault.on(
		"rename",
		(file: TAbstractFile, oldPath: string) => {
			console.log("rename event!")
			let fcEvt = cal.getEventById(oldPath);
			if (fcEvt != null) {
				fcEvt.setProp("id", file.path)
			}
		}
	));
	componentLifetime.registerEvent(app.metadataCache.on(
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
				cal.addEvent(hcEvt.toFCdata(pluginSettings))
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
				let newData: EventInput = hcEvt.toFCdata(pluginSettings);
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
	componentLifetime.registerEvent(app.metadataCache.on(
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
