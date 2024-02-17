import {
	ItemView,
	Menu,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

import {
	Calendar,
	EventDropArg,
	EventInput,
	EventSourceInput
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

import luxonPlugin, { toLuxonDateTime } from '@fullcalendar/luxon3';

import { getAPI, Literal } from 'obsidian-dataview';

import { DateTime } from 'luxon';

import { HCEventFilePath, HCEventFrontmatterSchema } from './data';
import HorizonCalPlugin from './main';

export const VIEW_TYPE = "horizoncal-view";

var uniq = 1;

export class HorizonCalView extends ItemView {
	constructor(plugin: HorizonCalPlugin, leaf: WorkspaceLeaf) {
		super(leaf);
		this.plugin = plugin;
		this.uniq = uniq++;
	}

	getViewType() {
		return VIEW_TYPE;
	}
	getIcon(): string {
		return "calendar-glyph";
	}
	getDisplayText() {
		return "Horizon Calendar " + this.uniq;
	}
	public navigation: false; // Don't generally let me click away from this view.

	plugin: HorizonCalPlugin;
	uniq: number; // Not structural.  Using this for sanitycheck during dev.
	viewContentEl: Element; // Reference grabbed during onOpen.
	calUIEl: HTMLElement; // Div created during onOpen to be fullcal's root.
	calUI: Calendar; // Fullcal's primary control object.

	eventSources: EventSourceInput[] = [
		{
			events: [
				{
					title: 'Event1',
					start: '2024-02-12'
				},
				{
					title: 'Event2',
					start: '2024-02-12T12:30:00',
					end: '2024-02-12T13:30:00'
					// 'background' property is neat.
				}
			],
			color: 'yellow',   // an option!
			textColor: 'black', // an option!

			startEditable: true,
			durationEditable: true,
		},
		{
			events: function (info, successCallback, failureCallback) {
				//console.log("---- queried for", info.start, "through", info.end);
				// .query({
				// 	start: info.start.valueOf(),
				// 	end: info.end.valueOf()
				// })

				// So about Dataview.
				//
				// Dataview does a lot.  Some of it helpful, some of it... imo, kind of a waste of time.
				// The helpful parts are so numerous they don't bear listing.
				// The less helpful parts:
				//   - Every field in the frontmatter that's got capital letters?  It gets cloned to a downcased one.
				//      -> this makes it confusing to range over the set because it's got duplicates!
				//      -> it's also a waste of memory!  Big sigh.
				//   - Anything that looks like a date got parsed to a Luxon DateTime object already!
				//      -> cool for the purpose of dv queries themselves...
				//      -> it's a little wasteful for our purposes, because we're just gonna turn around and integrate with another API that doesn't use that format.
				//      -> and when I said "date"?  I mean with YYYY-MM-DD.  It doesn't detect or do anything with HH:MM.
				//   - DV has gathered outlinks, inlinks, tasks, lists...
				//      -> the latter two don't really matter much in practice (event file contents are pretty short), but it's unnecessary work.
				//      -> inlinks required DV to index and parse *how much??* of my vault?  Very unnecessary work.
				//
				// The way to safely ignore all this is to peep `.file.frontmatter`.  That has the originals.
				// And I think someday we might have a compelling argument for making our own simpler query system that does _less_.
				// (Or find some flags to DV that ask it to Do Less; that'd be great.)
				// 
				type DVT_Record = Record<string, Literal> & {file: TFile};
				const dv = getAPI();
				const pages = dv.pages('"sys/horizoncal"')
					// TODO need this to be as un-eager as possible.
					// I think `.pages` is already gonna load and parse all those, so... no, bad.
					// "Dataview indexes its sources internally" states their docs, but I'm going to hope it doesn't do so proactively either.
					//
					// might be strongest to make our own func that starts teh DataArray chaining,
					// because this startsWith being *after* we're all the way in DataArray land?  yeah, not efficient.
					// We need to be able to pluck files with certain prefixes out of 10000 files without loading and indexing them all.
					// ...
					// increasingly, I think maybe we just... don't need or derive much value from DV at all.
					// I'm already not using any of their loading nor swizzling.
					// Letting DV do caching is about the only virtue I see but even that's a bit "hmmm".
					//
					// For offering easy integrations though: oh,
					// gross.  `dv.pagePaths` also still takes a string, not even a list lol.  I'm kinda not okay with that.
					// At first I was thinking "we can just offer a func that transforms date ranges into a list of file loading patterns",
					// but... a stringconcat of those?  Really?  Really?
					// The alternative is diving deeper and offering a function that glues together DV's `DataArray.from` and flatmaps that over `dv.page` and so on and so on.
					// Possible.  But would definitely require us to have import their package to do that stuff, and I'm... oof.  I'm Unsure.
					//
					// DOn't forget you still have the much, much simpler option of just calling `dv.pages` repeatedly and then conjoining it.
					// That DOES strongly push you to use folders per day, though.
					// So I guess we should do that and come back to the rest later.

					// Still going to have to have to call `page` (not `pages`) with specific targets to handle getting Tzch events.
					// 
					// Wonder if doing two months is actually just shrug for scale.  Probably is.
					
					// The other tiebreaker here is: moving a bunch of files in per-day dirs up one as a migration is trivial.
					// Adding another layer of dirs requires bothering to write code.
					//
					// Also i'm pretty sure obsidian itself is indexing at least all filenames proactively.  So it's free to look at that.
					.where((p: DVT_Record) => String(p.file.name).startsWith("evt-"))

				let results: EventInput[] = []
				for (let i in pages.array()) {
					// We're gonna read the frontmatter because it's least wild.
					//console.log("plz", pages[i]) 
					let evtFmRaw = pages[i].file.frontmatter

					// Quick check first.
					if (!evtFmRaw["evtDate"]) {
						// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
						continue
					}

					// Use Zod to do a lot more validation.
					const evtFmValidation = HCEventFrontmatterSchema.safeParse(evtFmRaw);
					if (!evtFmValidation.success) {
						// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
						console.log("conversion error:", evtFmValidation.error);
						continue
					}
					let evtFm = evtFmValidation.data;
					// console.log("evtFm ->", evtFm);

					// Turn our three-part time+date+timezone info into a single string we'll pass to FullCalendar.
					// This is going to *lose precision* -- FC can't actually usefully handle the TZ info.
					// (We'll diligently re-attach and persist TZ data every time we get any info back from FC.)
					let startDt = DateTime.fromObject({ ...evtFm.evtDate, ...evtFm.evtTime }, { zone: evtFm.evtTZ });
					let endDt = DateTime.fromObject({ ... (evtFm.endDate || evtFm.evtDate), ...evtFm.endTime }, { zone: evtFm.endTZ || evtFm.evtTZ });
					// TODO we do need to validate the zones were accepted here.  (Everything else should already be covered.)

					results.push({
						id: pages[i].file.path,
						title: evtFm.title,
						start: startDt.toISO() as string,
						end: endDt.toISO() as string,
					})
					//console.log("and that made?  this:", results.last())
				}

				successCallback(results)
				//console.log("---- query journey ended")
				return null
			},
			color: '#146792',
		},
	]

	async onOpen() {
		// The first element in containerEl is obsidian's own header.
		// The second is the content div you're expected to use for most content.
		this.viewContentEl = this.containerEl.children[1];
		this.viewContentEl.empty();
		this.viewContentEl.createEl("h4", { text: "Horizon Calendar" });
		this.calUIEl = this.viewContentEl.createEl("div", { cls: "horizoncal" });
		this._doCal();
	}

	async onPaneMenu(menu: Menu) {
		menu.addItem((item) => {
			item
				.setTitle("BONK FULLCAL 👈")
				.setIcon("document")
				.onClick(async () => {
					this._doCal();
				});
		});
	}

	async onResize() {
		this.calUI.render() // `updateSize()` might be enough, but, abundance of caution.
	}

	async onClose() {
		// Problematic: this thing is reattaching its stylesheet repeatedly, and it's not deleting that again.
		if (this.calUI) this.calUI.destroy()
	}

	_doCal() {
		if (this.calUI) this.calUI.destroy();

		// This change hook function is used for both fullcal's `eventDrop` and `eventResize` callbacks.
		// They're very similar, except the resize callback gets two different delta values in its info param.
		// They both have old and new events, though, and those both have start and end times,
		// and since we based all our logic on that rather than deltas, we get to reuse the function completely for both.
		let changeHook = async (info: EventDropArg | EventResizeDoneArg) => {
			// Step one: figure out what file we want to update for this.
			// Or, balk immediately if we can't figure it out somehow.
			if (!info.event.id) {
				alert("cannot alter that event; no known data source");
				info.revert()
				return
			}
			let file = this.plugin.app.vault.getAbstractFileByPath(info.event.id)
			if (!file || !(file instanceof TFile)) {
				alert("event id did not map to a file path!");
				info.revert()
				return
			}

			// Step two: we'll use the fileManager to do an update of the frontmatter.
			// (This handles a lot of serialization shenanigans for us very conveniently.)
			// (Although I am rather annoyed it doesn't give us control of order.  I *never* want to see the three-part time info separated from each other.)
			let evtFm2: any;
			await this.plugin.app.fileManager.processFrontMatter(file, (evtFm: any): void => {
				// First, shift the dates we got from fullcalendar back into the timezones this event specified.
				//  Fullcalendar doesn't retain timezones -- it flattens everything to an offset only (because javascript Date forces that),
				//   and it also shifts everything to the calendar-wide tz offset.  This is quite far from what we want.
				let newStartDt = toLuxonDateTime(info.event.start as Date, this.calUI).setZone(evtFm.evtTZ)
				let newEndDt = toLuxonDateTime(info.event.end as Date, this.calUI).setZone(evtFm.endTZ || evtFm.evtTZ)

				// Now start modifying the frontmatter...
				// And kick this off in an odd way: because we want to control order,
				// we're going to nuke every property and put them back in again.
				// We'll keep an object on the side with a copy of the originals,
				// then merge back any remaining properties that aren't ours at the end.
				// This dance creates stable ordering (and shifts user content to the bottom).
				let refFm = Object.assign({}, evtFm);
				for (var prop in evtFm) {
					delete evtFm[prop]
				}

				// Copy the most essential traits, like title and type!
				evtFm.title = refFm.title
				evtFm.evtType = refFm.evtType
				// The start date is always written!
				evtFm.evtDate = newStartDt.toFormat("yyyy-MM-dd")
				// The start time should only be written if it was there before, or if it's now nonzero.
				// (All day events have zero here, and should have stored no time.)
				if (refFm.evtTime || newStartDt.hour != 0 || newStartDt.minute != 0) {
					evtFm.evtTime = newStartDt.toFormat("HH:mm")
				}
				// Copy the TZ.
				// Or if it didn't exist: it does now!
				// (Right now, this just uses the local zone; future work is to use our own tzch events as cues.)
				evtFm.evtTZ = (refFm.evtTZ || DateTime.local().zoneName);
				// Write the end date only if it's different than the start date.
				if (newStartDt.year != newEndDt.year || newStartDt.month != newEndDt.month || newStartDt.day != newEndDt.day) {
					evtFm.endDate = newEndDt.toFormat("yyyy-MM-dd")
				}
				// As with start time: the end time should only be written if it was there before, or if it's now nonzero.
				// (All day events have zero here, and should have stored no time.)
				if (refFm.endTime || newEndDt.hour != 0 || newEndDt.minute != 0) {
					evtFm.endTime = newEndDt.toFormat("HH:mm")
				}
				// Copy the TZ, if it existed.
				if (refFm.endTZ) {
					evtFm.endTZ = refFm.endTZ
				}
				// Copy our other known but optional properties, if they existed.
				// (Be careful with equality here, as some of these are bools.)
				if (refFm.allDay !== undefined) {
					evtFm.allDay = refFm.allDay
				}
				if (refFm.completed !== undefined) {
					evtFm.completed = refFm.completed
				}

				// Now copy over any remaining properties in the original.
				// This is part of the dance to control property orders.
				for (var prop in refFm) {
					if (!(prop in evtFm)) {
						evtFm[prop] = refFm[prop]
					}
				}

				// Persistence?
				// It's handled magically by processFrontMatter as soon as this callback returns:
				//  it persists our mutations to the argument.

				// But we also keep this value because we need it in a moment to consider the file's path, as well.
				evtFm2 = refFm;
			});

			// Step three: decide if the filename is still applicable or needs to change -- and possibly change it!
			// If we change the filename, we'll also change the event ID.
			let path = HCEventFilePath.fromFrontmatter(evtFm2);
			let wholePath = path.wholePath;
			if (wholePath != info.event.id) {
				console.log("moving to", wholePath)
				try {
					// Wrapped in a `try` because it throws on "already exists".
					// TODO bother to react better to other errors.
					await this.plugin.app.vault.createFolder("sys/horizoncal/"+path.dirs)
				} catch {}
				await this.plugin.app.fileManager.renameFile(file, "sys/horizoncal/"+wholePath)
				info.event.setProp("id", "sys/horizoncal/"+wholePath)
			}
			// console.log(this.calUI.getEvents().map(evt => evt.id))
			//console.log("does that update the index?", calUI.getEventById("lolchanged")) // yes, good.
		}

		this.calUI = new Calendar(this.calUIEl, {
			plugins: [
				// View plugins
				dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin,
				// System glue plugins
				luxonPlugin,
			],
			initialView: 'timeGridFourDay',
			headerToolbar: {
				right: 'prev,next today',
				// future work: additional nav buttons of our own that manage via 'gotoDate' and 'visibleRange'.
				center: 'dayGridMonth,timeGridWeek,timeGridFourDay,timeGrid14Day,listWeek',
				left: 'title',
			},
			views: {
				timeGridFourDay: {
					type: 'timeGrid',
					duration: { days: 4 },
					dateIncrement: { days: 1 },
				},
				timeGrid14Day: {
					type: 'timeGrid',
					duration: { days: 14 },
					dateIncrement: { days: 1 },
				},
			},
			nowIndicator: true,
			// scrollTime: // probably ought to be set so "now" is in it, yo...
			// the 'scrollToTime' method might also be the right thing.
			scrollTimeReset: false,
			height: "auto",
			eventSources: this.eventSources,
			businessHours: {
				daysOfWeek: [1, 2, 3, 4, 5],
				startTime: '09:00',
				endTime: '23:00',
			},
			slotLabelInterval: '1:00',
			slotDuration: '00:30:00',
			snapDuration: '00:15:00',
			// slotLabelFormat: // actually, leaving this unset, because am/pm here is okay... since we use 24hr in the event labels.
			eventTimeFormat: { // like '14:30:00'
				hour: '2-digit',
				minute: '2-digit',
				omitZeroMinute: true,
				hour12: false
			},

			// Dragging?  Spicy.
			editable: true,
			eventDrop: changeHook,
			eventResize: changeHook,
			// okay, creating new events by clicking empty space might also need another hook.
			// https://fullcalendar.io/docs/eventClick is for opening?
			// i hope it understands doubleclick or... something.
		})
		this.calUI.render()
		// console.log("okay here's the calendar's event view!", this.calUI.getEvents())
		// console.log("did our TZs roundtrip?", this.calUI.getEvents().map(evt => evt.start))
		// No, no they did not. `.getTimezoneOffset()` gives a number in minutes, and it's alll the local ones.
		// console.log("howbout wat luxonifier?", this.calUI.getEvents().map(evt => toLuxonDateTime(evt.start as Date, this.calUI)))
		// NOPE, they're all `_zone: SystemZone` now.  Goddamnit.
	}
}
